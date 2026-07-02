import { ChannelManager } from "@/components/ChannelManager";
import { requireRegisteredUser } from "@/server/auth";
import { listPodcastsForUser } from "@/server/podcasts/data-repository";
import { getSelectedPodcastId } from "@/server/podcasts/selection";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  const user = await requireRegisteredUser();
  const podcasts = await listPodcastsForUser(user.uid);
  const selectedPodcastId = await getSelectedPodcastId();

  return (
    <ChannelManager podcasts={podcasts} selectedPodcastId={selectedPodcastId} />
  );
}
