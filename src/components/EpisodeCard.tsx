import Link from "next/link";
import { Episode } from "@/types/episode";
import { StatusBadge } from "./StatusBadge";

function GeneratedIndicator({ generated, label }: { generated: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${generated ? "text-green-600" : "text-gray-400"}`}>
      <span>{generated ? "✓" : "–"}</span>
      <span>{label}</span>
    </span>
  );
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function EpisodeCard({ episode }: { episode: Episode }) {
  return (
    <Link href={`/episodes/${episode.id}`}>
      <div className="bg-white border border-gray-200 rounded-lg p-5 hover:border-blue-400 hover:shadow-sm transition-all cursor-pointer">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-gray-900 leading-snug">{episode.title}</h3>
          <StatusBadge status={episode.status} />
        </div>

        <p className="mt-1.5 text-sm text-gray-500">{formatDate(episode.createdAt)}</p>
        <p className="mt-1 text-xs text-gray-400">{episode.audioFileName}</p>

        <div className="mt-3 flex flex-wrap gap-3">
          <GeneratedIndicator generated={episode.minutesGenerated} label="議事録" />
          <GeneratedIndicator generated={episode.xPostsGenerated} label="X投稿文" />
          <GeneratedIndicator generated={episode.seedsGenerated} label="会話のタネ" />
        </div>
      </div>
    </Link>
  );
}
