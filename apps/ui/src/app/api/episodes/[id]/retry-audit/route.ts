import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { requireSelectedPodcastForApi } from "@/server/podcasts/selection";
import {
  findEpisode,
  markEpisodeAuditing,
  restoreEpisodeStatusAfterSkippedAudit,
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

    // 処理中・編集中・公開済みの回は再監査しない。以前の指摘・判断はジョブ側で履歴へ保存し、
    // 新しい監査で指摘が無くても、以前に確認対象があった回は公開の再確認を求める。
    const previous = await markEpisodeAuditing(auth.podcastId, episodeId);
    if (!previous) {
      return NextResponse.json(
        { error: "処理中・公開済みのエピソードは再監査できません" },
        { status: 409 },
      );
    }

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

    const result = await runAutomatorJob({
      gcsTriggerObjectName: gcsObject,
      resumeFromAudit: true,
      podcastId: auth.podcastId,
    });

    if (result.skipped) {
      await restoreEpisodeStatusAfterSkippedAudit(auth.podcastId, episodeId, previous);
      console.error(
        "Failed to trigger automator Cloud Run job: AUTOMATOR_JOB_NAME is not set",
      );
      return NextResponse.json(
        { error: "ジョブの実行設定（AUTOMATOR_JOB_NAME）が未設定のため再開できません" },
        { status: 500 },
      );
    }

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
