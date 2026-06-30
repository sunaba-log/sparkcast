import { TopicProposalEditor } from "@/components/TopicProposalEditor";
import { requirePodcastAccess, requireSessionUser } from "@/server/auth";
import { getDefaultPodcastId } from "@/server/env";
import { listTopicProposals } from "@/server/topic-proposals/repository";
import type { TopicProposal } from "@/types/episode";

export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const user = await requireSessionUser();
  const podcastId = getDefaultPodcastId();
  await requirePodcastAccess(user.uid, podcastId);
  const proposals = await listTopicProposals(podcastId);

  const fallbackProposal: TopicProposal = {
    id: "demo-agenda",
    podcastId,
    targetPeriod: "2026-06-06",
    generatedAt: "2026-06-06 10:00:00",
    relatedNews: [
      {
        title: "Google Cloud、Cloud SQLの次世代アーキテクチャを発表",
        url: "https://example.com/news/cloud-sql-next",
        summary: "パフォーマンスが大幅に向上し、NoSQLライクな柔軟なインデックス機能が追加。",
        sourceReason: "AIニュース自動取得",
      },
    ],
    suggestedTopics: [
      {
        title: "Google Cloud、Cloud SQLの次世代アーキテクチャを発表",
        description:
          "パフォーマンスが大幅に向上し、NoSQLライクな柔軟なインデックス機能が追加パフォーマンスが大幅に向上し、NoSQLライクな柔軟なインデックス機能が追加。",
        suggestedPoints: [
          "発表されたCloud SQLの最新機能を、僕らのPodcastアプリに導入するべきか？",
          "先日発表されたCloud SQLのアップデート内容を解説しつつ...",
          "新機能の概要と、自分たちの現在のアーキテクチャの振り返り",
        ],
        relatedPastEpisodes: [5, 8],
      },
      {
        title: "TypeScript 5.8 の標準機能とパフォーマンス比較",
        description: "型チェックの高速化とモジュール解決の改善について解説します。",
        suggestedPoints: ["ビルド時間の短縮効果", "新規プロジェクトでの採用理由"],
        relatedPastEpisodes: [12],
      },
    ],
  };

  const displayProposals = proposals.length > 0 ? proposals : [fallbackProposal];

  return (
    <div className="space-y-6">
      <TopicProposalEditor proposals={displayProposals} />
    </div>
  );
}
