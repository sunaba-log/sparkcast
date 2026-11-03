import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getDbPool } from "@/server/db";
import { requireSelectedPodcastForApi } from "@/server/podcasts/selection";
import { createAudioPreviewUrl } from "@/server/storage";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const podcastId = await requireSelectedPodcastForApi(user);
    const episodeId = Number((await context.params).id);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      return NextResponse.json({ error: "エピソードが見つかりません" }, { status: 404 });
    }
    const result = await (await getDbPool()).query<{ source_audio_path: string | null }>(
      "SELECT source_audio_path FROM episodes WHERE podcast_id = $1 AND episode_id = $2 AND status <> 'upload_pending'",
      [podcastId, episodeId],
    );
    const objectPath = result.rows[0]?.source_audio_path;
    if (!objectPath) {
      return NextResponse.json({ error: "元音声が見つかりません" }, { status: 404 });
    }
    const url = await createAudioPreviewUrl(objectPath);
    return NextResponse.redirect(url, {
      status: 307,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_PODCAST_SELECTED") {
      return NextResponse.json({ error: "チャンネルを選択してください" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "操作権限がありません" }, { status: 403 });
    }
    console.error("Failed to preview source audio", error);
    return NextResponse.json({ error: "元音声を取得できませんでした" }, { status: 500 });
  }
}
