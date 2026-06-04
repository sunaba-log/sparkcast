import Link from "next/link";
import { getEpisodes } from "@/lib/episodes";
import { EpisodeCard } from "@/components/EpisodeCard";

export default async function EpisodeListPage() {
  const episodes = await getEpisodes();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">エピソード一覧</h1>
        <Link
          href="/upload"
          className="px-4 py-2 text-sm font-medium text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50 transition-colors"
        >
          新しいエピソードをアップロード
        </Link>
      </div>

      {episodes.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg">まだエピソードがありません</p>
          <p className="mt-2 text-sm">mp3ファイルをアップロードして最初のエピソードを作りましょう</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {episodes.map((episode) => (
            <EpisodeCard key={episode.id} episode={episode} />
          ))}
        </div>
      )}
    </div>
  );
}
