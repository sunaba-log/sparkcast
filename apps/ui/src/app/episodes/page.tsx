import { getEpisodes } from "@/lib/episodes";
import { EpisodeMasterDetail } from "@/components/EpisodeMasterDetail";
import { requireRegisteredUser } from "@/server/auth";
import { getPodcast } from "@/server/podcasts/data-repository";
import { requireSelectedPodcast } from "@/server/podcasts/selection";
import { isLocalUiDemoEnabled } from "@/server/env";
import { UI_DEMO_PODCAST } from "@/server/ui-demo";

export const dynamic = "force-dynamic";

export default async function EpisodeListPage({
  searchParams,
}: {
  searchParams: Promise<{ episode?: string }>;
}) {
  const user = await requireRegisteredUser();
  const podcastId = await requireSelectedPodcast(user);
  const [episodes, podcast, { episode }] = await Promise.all([
    getEpisodes(podcastId),
    isLocalUiDemoEnabled() ? Promise.resolve(UI_DEMO_PODCAST) : getPodcast(podcastId),
    searchParams,
  ]);

  return (
    <EpisodeMasterDetail
      initialEpisodes={episodes}
      podcast={podcast}
      initialSelectedId={episode}
    />
  );
}
