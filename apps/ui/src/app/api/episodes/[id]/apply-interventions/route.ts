import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getSessionUser } from "@/server/auth";
import {
  findEpisode,
  listDirectorInterventions,
  markEpisodeEditing,
  updateDirectorInterventions,
} from "@/server/episodes/data-repository";
import { requireSelectedPodcastForApi } from "@/server/podcasts/selection";
import { isLocalUiDemoEnabled } from "@/server/env";

import {
  createPolicyEditPlan,
  loadPolicyReview,
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

    // 訂正介入パネル（planVersion なし）からの要求も、統合レビューと同じ編集計画で処理する。
    // 外部編集サービスへ判断を直接送る旧経路は廃止した（判断の確認を迂回できないようにする）。
    let planVersion = input.planVersion;
    if (planVersion === undefined) {
      const existing = await listDirectorInterventions(podcastId, episodeId);
      const ids = new Set(input.interventions.map((item) => item.id));
      if (
        ids.size !== input.interventions.length ||
        ids.size !== existing.length ||
        existing.some((item) => !ids.has(item.id)) ||
        input.interventions.some((item) => item.status === "pending")
      ) {
        return NextResponse.json(
          { error: "すべての訂正介入を判断してください" },
          { status: 409 },
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
      planVersion = (await loadPolicyReview(podcastId, episodeId)).version;
    }

    const interventions = await listDirectorInterventions(podcastId, episodeId);
    if (interventions.some((item) => item.status === "pending")) {
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
    let plan: Awaited<ReturnType<typeof createPolicyEditPlan>>;
    try {
      plan = await createPolicyEditPlan(podcastId, episodeId, planVersion);
    } catch (error) {
      // 計画を作る前の検証失敗（未判断・古い版・範囲不正など）は、編集を始めずに承認待ちへ戻す
      await (
        await getDbPool()
      ).query(
        "UPDATE episodes SET status = 'awaiting_approval' WHERE podcast_id = $1 AND episode_id = $2 AND status = 'editing'",
        [podcastId, episodeId],
      );
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "編集計画を作成できませんでした",
        },
        { status: 409 },
      );
    }
    try {
      const job = await runAutomatorJob({
        podcastId,
        gcsTriggerObjectName: plan.sourcePath,
        resumeFromAudit: true,
        editPlanId: plan.id,
      });
      if (job.skipped) throw new Error("音声編集ジョブが設定されていません");
      return NextResponse.json({ ok: true, status: "editing", planId: plan.id });
    } catch (error) {
      // An ambiguous network failure may have dispatched the job; never unlock for automatic resend.
      await policyContentRef(podcastId, episodeId)
        .collection("audio_edit_plans")
        .doc(plan.id)
        .set({ dispatchError: true }, { merge: true });
      throw error;
    }
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
