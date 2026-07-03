import { TopicProposalEditor } from "@/components/TopicProposalEditor";
import { requireRegisteredUser } from "@/server/auth";
import { requireSelectedPodcast } from "@/server/podcasts/selection";
import { listTopicProposals } from "@/server/topic-proposals/repository";

export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const user = await requireRegisteredUser();
  const podcastId = await requireSelectedPodcast(user);
  const proposals = await listTopicProposals(podcastId);

  return (
    <div className="space-y-6">
      <TopicProposalEditor proposals={proposals} />
    </div>
  );
}
