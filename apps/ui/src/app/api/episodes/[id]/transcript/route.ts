import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getDbPool } from "@/server/db";
import { listTranscriptSegments } from "@/server/episodes/data-repository";
import { requireSelectedPodcastForApi } from "@/server/podcasts/selection";

// 話者・時刻つきの文字起こし（#166）。選択中のチャンネルのエピソードだけ返す。
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
    const owned = await (await getDbPool()).query(
      "SELECT 1 FROM episodes WHERE podcast_id = $1 AND episode_id = $2",
      [podcastId, episodeId],
    );
    if (owned.rowCount !== 1) {
      return NextResponse.json({ error: "エピソードが見つかりません" }, { status: 404 });
    }
    const segments = await listTranscriptSegments(podcastId, episodeId);
    return NextResponse.json({ segments }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_PODCAST_SELECTED") {
      return NextResponse.json({ error: "チャンネルを選択してください" }, { status: 400 });
    }
    console.error("Failed to load transcript", error);
    return NextResponse.json({ error: "文字起こしを取得できませんでした" }, { status: 500 });
  }
}
