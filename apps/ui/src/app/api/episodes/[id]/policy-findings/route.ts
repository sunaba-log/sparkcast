import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { findEpisode, listPolicyFindings } from "@/server/episodes/data-repository";
import { requireSelectedPodcastForApi } from "@/server/podcasts/selection";
import { isLocalUiDemoEnabled } from "@/server/env";
import { UI_DEMO_POLICY_FINDINGS } from "@/server/ui-demo";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (isLocalUiDemoEnabled()) {
      const { id } = await context.params;
      return NextResponse.json({
        findings: id === "3" ? UI_DEMO_POLICY_FINDINGS : [],
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const podcastId = await requireSelectedPodcastForApi(user);
    const episodeId = Number((await context.params).id);
    if (!Number.isInteger(episodeId) || episodeId <= 0 || !(await findEpisode(podcastId, episodeId))) {
      return NextResponse.json({ error: "エピソードが見つかりません" }, { status: 404 });
    }
    const findings = await listPolicyFindings(podcastId, episodeId);
    return NextResponse.json({ findings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_PODCAST_SELECTED") {
      return NextResponse.json({ error: "チャンネルを選択してください" }, { status: 400 });
    }
    console.error("Failed to load policy findings", error);
    return NextResponse.json({ error: "音声校正の検知結果を取得できませんでした" }, { status: 500 });
  }
}
