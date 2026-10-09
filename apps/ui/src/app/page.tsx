import { ChannelManager } from "@/components/ChannelManager";
import { requireRegisteredUser } from "@/server/auth";
import {
  getUserDefaultPodcastId,
  listPodcastsForUser,
} from "@/server/podcasts/data-repository";
import { resolveEffectivePodcastId } from "@/server/podcasts/selection";
import { isLocalUiDemoEnabled } from "@/server/env";
import { UI_DEMO_PODCAST, UI_DEMO_PODCASTS } from "@/server/ui-demo";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  const user = await requireRegisteredUser();
  if (isLocalUiDemoEnabled()) {
    return (
      <ChannelManager
        podcasts={UI_DEMO_PODCASTS}
        selectedPodcastId={UI_DEMO_PODCAST.id}
        defaultPodcastId={UI_DEMO_PODCAST.id}
      />
    );
  }
  const podcasts = await listPodcastsForUser(user.uid);
  const selectedPodcastId = await resolveEffectivePodcastId(user);
  const defaultPodcastId = await getUserDefaultPodcastId(user.uid);

  return (
    <ChannelManager
      podcasts={podcasts}
      selectedPodcastId={selectedPodcastId}
      defaultPodcastId={defaultPodcastId}
    />
  );
}
