import { getEpisodes } from "@/lib/episodes";
import { EpisodeMasterDetail } from "@/components/EpisodeMasterDetail";
import { requireRegisteredUser } from "@/server/auth";
import { getPodcast } from "@/server/podcasts/data-repository";
import { requireSelectedPodcast } from "@/server/podcasts/selection";

export const dynamic = "force-dynamic";

export default async function EpisodeListPage() {
  const user = await requireRegisteredUser();
  const podcastId = await requireSelectedPodcast(user);
  const episodes = await getEpisodes(podcastId);
  const podcast = await getPodcast(podcastId);

  return <EpisodeMasterDetail initialEpisodes={episodes} podcast={podcast} />;
}
