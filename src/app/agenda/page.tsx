import { TopicProposalEditor } from "@/components/TopicProposalEditor";
import {
  requirePodcastAccess,
  requireSessionUser,
} from "@/server/auth";
import { getDefaultPodcastId } from "@/server/env";
import { listTopicProposals } from "@/server/topic-proposals/repository";

export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const user = await requireSessionUser();
  const podcastId = getDefaultPodcastId();
  await requirePodcastAccess(user.uid, podcastId);
  const proposals = await listTopicProposals(podcastId);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">収録アジェンダ</h1>
      <p className="mt-1 mb-6 text-sm text-gray-500">
        関連ニュースと次回の会話の種を確認・編集できます。
      </p>
      {proposals.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-500">
          まだアジェンダが生成されていません
        </p>
      ) : (
        <div className="space-y-6">
          {proposals.map((proposal) => (
            <TopicProposalEditor key={proposal.id} proposal={proposal} />
          ))}
        </div>
      )}
    </div>
  );
}
