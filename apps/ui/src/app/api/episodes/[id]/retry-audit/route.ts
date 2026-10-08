import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { requireSelectedPodcastForApi } from "@/server/podcasts/selection";
import {
  findEpisode,
  markEpisodeAuditing,
} from "@/server/episodes/data-repository";
import { getDbPool } from "@/server/db";
import { runAutomatorJob } from "@/server/episodes/automator-jobs";

async function authorize() {
  const user = await getSessionUser();
  if (!user) return null;
  const podcastId = await requireSelectedPodcastForApi(user);
  return { user, podcastId };
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorize();
    if (!auth) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const episodeId = Number((await context.params).id);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      return NextResponse.json({ error: "episode IDが不正です" }, { status: 400 });
    }

    const episode = await findEpisode(auth.podcastId, episodeId);
    if (!episode) {
      return NextResponse.json({ error: "見つかりません" }, { status: 404 });
    }

    await markEpisodeAuditing(auth.podcastId, episodeId);

    // GCSオブジェクトパスを取得
    const pool = await getDbPool();
    const row = (
      await pool.query<{ source_audio_path: string | null }>(
        `SELECT source_audio_path FROM episodes WHERE podcast_id = $1 AND episode_id = $2`,
        [auth.podcastId, episodeId],
      )
    ).rows[0];

    const gcsObject =
      row?.source_audio_path ||
      `podcasts/${auth.podcastId}/episodes/${episodeId}/source/${episode.audioFileName}`;

    await runAutomatorJob({
      gcsTriggerObjectName: gcsObject,
      resumeFromAudit: true,
      podcastId: auth.podcastId,
    }).catch((err) => {
      console.warn("Failed to trigger automator Cloud Run job for audit retry:", err);
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_PODCAST_SELECTED") {
      return NextResponse.json(
        { error: "チャンネルが選択されていません" },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "操作権限がありません" }, { status: 403 });
    }
    console.error("Failed to retry audit for episode", error);
    return NextResponse.json({ error: "再開に失敗しました" }, { status: 500 });
  }
}
