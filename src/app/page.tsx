import { getEpisodes } from "@/lib/episodes";
import { EpisodeMasterDetail } from "@/components/EpisodeMasterDetail";
import { requirePodcastAccess, requireSessionUser } from "@/server/auth";
import { getDefaultPodcastId } from "@/server/env";
import { getPodcast } from "@/server/podcasts/data-repository";

export const dynamic = "force-dynamic";

export default async function EpisodeListPage() {
  const user = await requireSessionUser();
  const podcastId = getDefaultPodcastId();
  await requirePodcastAccess(user.uid, podcastId);
  const episodes = await getEpisodes();
  const podcast = await getPodcast(podcastId);

  return <EpisodeMasterDetail initialEpisodes={episodes} podcast={podcast} />;
}
