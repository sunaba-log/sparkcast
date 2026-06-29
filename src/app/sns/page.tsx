import { SNSPostMasterDetail } from "@/components/SNSPostMasterDetail";
import { requirePodcastAccess, requireSessionUser } from "@/server/auth";
import { getDefaultPodcastId } from "@/server/env";

export const dynamic = "force-dynamic";

export default async function SNSPostPage() {
  const user = await requireSessionUser();
  await requirePodcastAccess(user.uid, getDefaultPodcastId());

  return <SNSPostMasterDetail />;
}
