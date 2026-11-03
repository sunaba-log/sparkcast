import { TopicProposalEditor } from "@/components/TopicProposalEditor";
import { requireRegisteredUser } from "@/server/auth";
import { requireSelectedPodcast } from "@/server/podcasts/selection";
import { listTopicProposals } from "@/server/topic-proposals/repository";
import { isLocalUiDemoEnabled } from "@/server/env";
import { UI_DEMO_TOPIC_PROPOSALS } from "@/server/ui-demo";

export const dynamic = "force-dynamic";

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ proposal?: string; topic?: string }>;
}) {
  const user = await requireRegisteredUser();
  const podcastId = await requireSelectedPodcast(user);
  const [proposals, { proposal, topic }] = await Promise.all([
    isLocalUiDemoEnabled()
      ? Promise.resolve(UI_DEMO_TOPIC_PROPOSALS)
      : listTopicProposals(podcastId),
    searchParams,
  ]);
  const topicIndex =
    topic !== undefined && /^\d+$/.test(topic) ? Number(topic) : undefined;

  return (
    <div className="space-y-6">
      <TopicProposalEditor
        proposals={proposals}
        initialProposalId={proposal}
        initialTopicIndex={topicIndex}
      />
    </div>
  );
}
