import Link from "next/link";
import { notFound } from "next/navigation";
import { mapToSNSPostItem } from "@/lib/sns";
import { SNSPostMasterDetail } from "@/components/SNSPostMasterDetail";
import { requireRegisteredUser } from "@/server/auth";
import { findEpisode } from "@/server/episodes/data-repository";
import { requireSelectedPodcast } from "@/server/podcasts/selection";

export const dynamic = "force-dynamic";

export default async function SNSPostDetailPage({
  params,
}: {
  params: Promise<{ episodeId: string; postId: string }>;
}) {
  const user = await requireRegisteredUser();
  const podcastId = await requireSelectedPodcast(user);
  const { episodeId, postId } = await params;
  const parsedEpisodeId = Number(episodeId);

  if (!Number.isSafeInteger(parsedEpisodeId)) {
    notFound();
  }

  const episode = await findEpisode(podcastId, parsedEpisodeId);
  const post = episode?.xPosts.find((item) => item.id === postId);
  if (!episode || !post) {
    notFound();
  }

  return (
    <div className="h-full">
      <div className="mb-4">
        <Link href="/sns" className="text-sm text-blue-600 hover:underline">
          ← SNS投稿一覧に戻る
        </Link>
      </div>
      <SNSPostMasterDetail
        initialPosts={[mapToSNSPostItem(episode, post)]}
        initialSelectedId={postId}
        detailOnly
      />
    </div>
  );
}
