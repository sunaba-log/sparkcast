import { notFound } from "next/navigation";
import Link from "next/link";
import { getEpisodeById } from "@/lib/episodes";
import { StatusBadge } from "@/components/StatusBadge";
import { CopyButton } from "@/components/CopyButton";

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SectionCard({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function RegenerateButton() {
  return (
    <button className="px-3 py-1 text-xs font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition-colors">
      再生成
    </button>
  );
}

export default async function EpisodeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const episode = await getEpisodeById(id);

  if (!episode) {
    notFound();
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← エピソード一覧に戻る
        </Link>
      </div>

      <div className="mb-6">
        <div className="flex items-start gap-3">
          <h1 className="text-2xl font-bold text-gray-900 flex-1">{episode.title}</h1>
          <StatusBadge status={episode.status} />
        </div>
        <div className="mt-2 text-sm text-gray-500 space-y-0.5">
          <p>{formatDate(episode.createdAt)}</p>
          <p className="text-xs text-gray-400">{episode.audioFileName}</p>
        </div>
      </div>

      <div className="grid gap-5">
        {/* 議事録 */}
        <SectionCard
          title="議事録"
          action={episode.minutesGenerated ? <RegenerateButton /> : undefined}
        >
          {episode.minutesGenerated && episode.minutes ? (
            <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap text-sm leading-relaxed">
              {episode.minutes}
            </div>
          ) : (
            <p className="text-sm text-gray-400">まだ議事録が生成されていません</p>
          )}
        </SectionCard>

        {/* X投稿文 */}
        <SectionCard
          title="X投稿文リコメンド"
          action={episode.xPostsGenerated ? <RegenerateButton /> : undefined}
        >
          {episode.xPostsGenerated && episode.xPostRecommendations.length > 0 ? (
            <div className="space-y-4">
              {episode.xPostRecommendations.map((post, index) => (
                <div key={index} className="bg-gray-50 border border-gray-200 rounded-md p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-gray-800 flex-1 leading-relaxed whitespace-pre-wrap">{post}</p>
                    <div className="flex-shrink-0 pt-0.5">
                      <CopyButton text={post} />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-gray-400">{post.length}文字</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">まだX投稿文が生成されていません</p>
          )}
        </SectionCard>

        {/* 会話のタネ */}
        <SectionCard
          title="会話のタネ"
          action={episode.seedsGenerated ? <RegenerateButton /> : undefined}
        >
          {episode.seedsGenerated && episode.conversationSeeds.length > 0 ? (
            <div className="space-y-3">
              {episode.conversationSeeds.map((seed, index) => (
                <div key={index} className="bg-gray-50 border border-gray-200 rounded-md p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-gray-800 flex-1 leading-relaxed">{seed}</p>
                    <div className="flex-shrink-0 pt-0.5">
                      <CopyButton text={seed} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">まだ会話のタネが生成されていません</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
