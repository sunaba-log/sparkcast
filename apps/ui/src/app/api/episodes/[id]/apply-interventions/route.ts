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

const applySchema = z.object({
  interventions: z.array(z.object({
    id: z.string().min(1).max(200),
    correctionScript: z.string().min(1).max(10_000),
    status: z.enum(["pending", "approved", "rejected"]),
  })).default([]),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const podcastId = await requireSelectedPodcastForApi(user);
    const episodeId = Number((await context.params).id);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      return NextResponse.json({ error: "エピソードが見つかりません" }, { status: 404 });
    }
    const episode = await findEpisode(podcastId, episodeId);
    if (!episode) return NextResponse.json({ error: "エピソードが見つかりません" }, { status: 404 });
    if (episode.status !== "awaiting_approval") {
      return NextResponse.json({ error: "このエピソードは承認待ちではありません" }, { status: 409 });
    }

    const input = applySchema.parse(await request.json());
    const [existingInterventions, policyFindings] = await Promise.all([
      listDirectorInterventions(podcastId, episodeId),
      listPolicyFindings(podcastId, episodeId),
    ]);
    if (policyFindings.some((finding) => finding.status === "pending")) {
      return NextResponse.json({ error: "すべての音声校正項目を判断してください" }, { status: 409 });
    }
    if (
      !input.interventions.some((intervention) => intervention.status === "approved")
      && !policyFindings.some((finding) => finding.status === "approved")
    ) {
      return NextResponse.json({ error: "承認した校正項目を1件以上選択してください" }, { status: 400 });
    }
    const existingIds = new Set(
      existingInterventions.map(
        (intervention) => intervention.id,
      ),
    );
    if (input.interventions.some((intervention) => !existingIds.has(intervention.id))) {
      return NextResponse.json({ error: "存在しない訂正案が含まれています" }, { status: 400 });
    }
    const editorUrl = process.env.AUDIO_EDITOR_URL;
    if (!editorUrl) {
      console.error("AUDIO_EDITOR_URL is not configured");
      return NextResponse.json({ error: "音声編集ジョブが設定されていません" }, { status: 503 });
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
        interventions: input.interventions.filter((intervention) => intervention.status === "approved"),
        policyFindings: policyFindings.filter((finding) => finding.status === "approved"),
      }),
    });
    if (!response.ok) {
      console.error("Audio editor rejected intervention job", response.status);
      return NextResponse.json({ error: "音声編集ジョブを開始できませんでした" }, { status: 502 });
    }
    if (!(await markEpisodeEditing(podcastId, episodeId))) {
      return NextResponse.json({ error: "エピソードの状態が更新されたため、もう一度確認してください" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, status: "editing" });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "入力内容が不正です" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "NO_PODCAST_SELECTED") {
      return NextResponse.json({ error: "チャンネルを選択してください" }, { status: 400 });
    }
    console.error("Failed to apply director interventions", error);
    return NextResponse.json({ error: "音声編集を開始できませんでした" }, { status: 500 });
  }
}
