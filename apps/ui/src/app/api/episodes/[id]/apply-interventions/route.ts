import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getSessionUser } from "@/server/auth";
import {
  findEpisode,
  listDirectorInterventions,
  listPolicyFindings,
  markEpisodeEditing,
  updateDirectorInterventions,
} from "@/server/episodes/data-repository";
import { requireSelectedPodcastForApi } from "@/server/podcasts/selection";
import { isLocalUiDemoEnabled } from "@/server/env";

import {
  createPolicyEditPlan,
  policyContentRef,
} from "@/server/policy/repository";
import { runAutomatorJob } from "@/server/episodes/automator-jobs";
import { getDbPool } from "@/server/db";

const applySchema = z.object({
  planVersion: z.number().int().positive().optional(),
  retryPlanId: z.string().uuid().optional(),
  interventions: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        correctionScript: z.string().min(1).max(10_000),
        status: z.enum(["pending", "approved", "rejected"]),
        action: z.enum(["insert", "cut", "silence", "replace"]).optional(),
        start: z.number().min(0).optional(),
        end: z.number().min(0).optional(),
        assetId: z.string().uuid().nullable().optional(),
      }),
    )
    .default([]),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (isLocalUiDemoEnabled()) {
      const { id } = await context.params;
      if (id !== "3") {
        return NextResponse.json(
          { error: "エピソードが見つかりません" },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true, status: "editing" });
    }
    const user = await getSessionUser();
    if (!user)
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const podcastId = await requireSelectedPodcastForApi(user);
    const episodeId = Number((await context.params).id);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      return NextResponse.json(
        { error: "エピソードが見つかりません" },
        { status: 404 },
      );
    }
    const episode = await findEpisode(podcastId, episodeId);
    if (!episode)
      return NextResponse.json(
        { error: "エピソードが見つかりません" },
        { status: 404 },
      );
    const input = applySchema.parse(await request.json());
    if (input.retryPlanId) {
      if (episode.status !== "editing")
        return NextResponse.json(
          { error: "再送できる編集要求がありません" },
          { status: 409 },
        );
      const root = policyContentRef(podcastId, episodeId);
      const review = (
        await root.collection("policy_reviews").doc("current").get()
      ).data();
      const plan = (
        await root.collection("audio_edit_plans").doc(input.retryPlanId).get()
      ).data();
      if (review?.lockedPlanId !== input.retryPlanId || !plan)
        return NextResponse.json(
          { error: "編集要求が見つかりません" },
          { status: 404 },
        );
      if (plan.status === "running" || plan.status === "applied")
        return NextResponse.json({ ok: true, status: "editing" });
      if (plan.status !== "queued")
        return NextResponse.json(
          { error: "編集に失敗しています。再監査してください" },
          { status: 409 },
        );
      const job = await runAutomatorJob({
        podcastId,
        gcsTriggerObjectName: plan.sourcePath,
        resumeFromAudit: true,
        editPlanId: input.retryPlanId,
      });
      if (job.skipped)
        return NextResponse.json(
          { error: "編集ジョブが設定されていません" },
          { status: 503 },
        );
      await root
        .collection("audio_edit_plans")
        .doc(input.retryPlanId)
        .update({ dispatchError: false });
      return NextResponse.json({ ok: true, status: "editing" });
    }
    if (episode.status !== "awaiting_approval") {
      return NextResponse.json(
        { error: "このエピソードは承認待ちではありません" },
        { status: 409 },
      );
    }

    const [existingInterventions, policyFindings] = await Promise.all([
      listDirectorInterventions(podcastId, episodeId),
      listPolicyFindings(podcastId, episodeId),
    ]);
    if (input.planVersion !== undefined) {
      if (existingInterventions.some((item) => item.status === "pending")) {
        return NextResponse.json(
          { error: "既存の訂正介入を先に判断・保存してください。" },
          { status: 409 },
        );
      }
      // Claim the episode before enqueuing to prevent concurrent edits or duplicate submissions.
      if (!(await markEpisodeEditing(podcastId, episodeId))) {
        return NextResponse.json(
          { error: "エピソードの状態が更新されています" },
          { status: 409 },
        );
      }
      let planId: string | undefined;
      try {
        const plan = await createPolicyEditPlan(
          podcastId,
          episodeId,
          input.planVersion,
        );
        planId = plan.id;
        const job = await runAutomatorJob({
          podcastId,
          gcsTriggerObjectName: plan.sourcePath,
          resumeFromAudit: true,
          editPlanId: plan.id,
        });
        if (job.skipped) throw new Error("音声編集ジョブが設定されていません");
        return NextResponse.json({
          ok: true,
          status: "editing",
          planId: plan.id,
        });
      } catch (error) {
        // An ambiguous network failure may have dispatched the job; never unlock for automatic resend.
        if (planId) {
          await policyContentRef(podcastId, episodeId)
            .collection("audio_edit_plans")
            .doc(planId)
            .set({ dispatchError: true }, { merge: true });
        } else {
          await (
            await getDbPool()
          ).query(
            "UPDATE episodes SET status = 'awaiting_approval' WHERE podcast_id = $1 AND episode_id = $2 AND status = 'editing'",
            [podcastId, episodeId],
          );
        }
        throw error;
      }
    }
    const unifiedReview = await policyContentRef(podcastId, episodeId)
      .collection("policy_reviews")
      .doc("current")
      .get();
    if (unifiedReview.exists && policyFindings.length > 0)
      return NextResponse.json(
        { error: "統合された編集案を保存してから編集を開始してください" },
        { status: 409 },
      );
    if (policyFindings.some((finding) => finding.status === "pending")) {
      return NextResponse.json(
        { error: "すべての音声校正項目を判断してください" },
        { status: 409 },
      );
    }
    if (
      !input.interventions.some(
        (intervention) => intervention.status === "approved",
      ) &&
      !policyFindings.some((finding) => finding.status === "approved")
    ) {
      return NextResponse.json(
        { error: "承認した校正項目を1件以上選択してください" },
        { status: 400 },
      );
    }
    const existingIds = new Set(
      existingInterventions.map((intervention) => intervention.id),
    );
    if (
      input.interventions.some(
        (intervention) => !existingIds.has(intervention.id),
      )
    ) {
      return NextResponse.json(
        { error: "存在しない訂正案が含まれています" },
        { status: 400 },
      );
    }
    const editorUrl = process.env.AUDIO_EDITOR_URL;
    if (!editorUrl) {
      console.error("AUDIO_EDITOR_URL is not configured");
      return NextResponse.json(
        { error: "音声編集ジョブが設定されていません" },
        { status: 503 },
      );
    }

    if (input.interventions.length > 0) {
      await updateDirectorInterventions({
        podcastId,
        episodeId,
        interventions: input.interventions,
        updatedBy: user.uid,
      });
    }
    const response = await fetch(editorUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.AUDIO_EDITOR_API_TOKEN
          ? { Authorization: `Bearer ${process.env.AUDIO_EDITOR_API_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        podcastId,
        episodeId,
        interventions: input.interventions.filter(
          (intervention) => intervention.status === "approved",
        ),
        policyFindings: policyFindings.filter(
          (finding) => finding.status === "approved",
        ),
      }),
    });
    if (!response.ok) {
      console.error("Audio editor rejected intervention job", response.status);
      return NextResponse.json(
        { error: "音声編集ジョブを開始できませんでした" },
        { status: 502 },
      );
    }
    if (!(await markEpisodeEditing(podcastId, episodeId))) {
      return NextResponse.json(
        { error: "エピソードの状態が更新されたため、もう一度確認してください" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, status: "editing" });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "入力内容が不正です" },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "NO_PODCAST_SELECTED") {
      return NextResponse.json(
        { error: "チャンネルを選択してください" },
        { status: 400 },
      );
    }
    console.error("Failed to apply director interventions", error);
    return NextResponse.json(
      { error: "音声編集を開始できませんでした" },
      { status: 500 },
    );
  }
}
