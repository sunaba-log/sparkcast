import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { findEpisode, listDirectorInterventions } from "@/server/episodes/data-repository";
import { requireSelectedPodcastForApi } from "@/server/podcasts/selection";
import { isLocalUiDemoEnabled } from "@/server/env";
import { UI_DEMO_DIRECTOR_INTERVENTIONS } from "@/server/ui-demo";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (isLocalUiDemoEnabled()) {
      const { id } = await context.params;
      return NextResponse.json({
        interventions: id === "3" ? UI_DEMO_DIRECTOR_INTERVENTIONS : [],
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const podcastId = await requireSelectedPodcastForApi(user);
    const episodeId = Number((await context.params).id);
    if (!Number.isInteger(episodeId) || episodeId <= 0 || !(await findEpisode(podcastId, episodeId))) {
      return NextResponse.json({ error: "エピソードが見つかりません" }, { status: 404 });
    }
    const interventions = await listDirectorInterventions(podcastId, episodeId);
    return NextResponse.json({ interventions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_PODCAST_SELECTED") {
      return NextResponse.json({ error: "チャンネルを選択してください" }, { status: 400 });
    }
    console.error("Failed to load director interventions", error);
    return NextResponse.json({ error: "監査結果を取得できませんでした" }, { status: 500 });
  }
}
