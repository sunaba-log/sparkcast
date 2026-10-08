import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import {
  findEpisode,
  markEpisodePublishingOriginal,
} from "@/server/episodes/data-repository";
import { runAutomatorJob } from "@/server/episodes/automator-jobs";
import { getDbPool } from "@/server/db";
import { requireSelectedPodcastForApi } from "@/server/podcasts/selection";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const podcastId = await requireSelectedPodcastForApi(user);
    const episodeId = Number((await context.params).id);
    const episode = await findEpisode(podcastId, episodeId);
    if (!episode || !Number.isInteger(episodeId) || episodeId <= 0) {
      return NextResponse.json({ error: "エピソードが見つかりません" }, { status: 404 });
    }
    if (!(await markEpisodePublishingOriginal(podcastId, episodeId))) {
      return NextResponse.json({ error: "最終公開確認が必要です" }, { status: 409 });
    }
    const source = await (await getDbPool()).query<{ source_audio_path: string | null }>(
      "SELECT source_audio_path FROM episodes WHERE podcast_id = $1 AND episode_id = $2",
      [podcastId, episodeId],
    );
    const gcsTriggerObjectName =
      source.rows[0]?.source_audio_path ||
      `podcasts/${podcastId}/episodes/${episodeId}/source/${episode.audioFileName}`;
    const result = await runAutomatorJob({
      gcsTriggerObjectName,
      resumeFromAudit: true,
      publishOriginal: true,
      podcastId,
    });
    if (result.skipped) {
      return NextResponse.json({ error: "公開ジョブが設定されていません" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, status: "processing" });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_PODCAST_SELECTED") {
      return NextResponse.json({ error: "チャンネルを選択してください" }, { status: 400 });
    }
    console.error("Failed to confirm original publication", error);
    return NextResponse.json({ error: "原音声の公開を開始できませんでした" }, { status: 500 });
  }
}
