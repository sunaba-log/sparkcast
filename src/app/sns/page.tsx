import { SNSPostMasterDetail } from "@/components/SNSPostMasterDetail";
import { requireRegisteredUser } from "@/server/auth";
import { requireSelectedPodcast } from "@/server/podcasts/selection";
import { listEpisodesAndPromotionsPaginated } from "@/server/episodes/data-repository";
import { mapToSNSPostItem } from "@/app/api/sns/route";

export const dynamic = "force-dynamic";

export default async function SNSPostPage() {
  const user = await requireRegisteredUser();
  const podcastId = await requireSelectedPodcast(user);

  // Load the initial 5 episodes and their promotions
  const { episodes, hasMore } = await listEpisodesAndPromotionsPaginated(podcastId, 5, 0);

  // Map to SNSPostItem structure
  const initialPosts = episodes.flatMap((ep) =>
    ep.xPosts.map((p) => mapToSNSPostItem(ep, p))
  );

  return <SNSPostMasterDetail initialPosts={initialPosts} initialHasMore={hasMore} />;
}
