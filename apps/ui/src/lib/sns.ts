import type { Episode, EpisodePromotion } from "@/types/episode";

export type SNSPostItem = {
  id: string;
  episodeId: string;
  episodeTitle: string;
  status: "pending" | "posted";
  scheduledDate: { yyyy: string; mm: string; dd: string; hh: string; min: string };
  message: string;
  platformUrls: { apple: string; amazon: string; spotify: string };
  hashtags: string[];
  generatedAt: string;
  updatedAt: string;
};

export function mapToSNSPostItem(ep: Episode, p: EpisodePromotion): SNSPostItem {
  const schedTime = p.scheduledTime ? new Date(p.scheduledTime) : new Date(p.generatedAt || ep.createdAt);

  const isInvalid = isNaN(schedTime.getTime());
  const validDate = isInvalid ? new Date() : schedTime;

  const yyyy = String(validDate.getFullYear());
  const mm = String(validDate.getMonth() + 1).padStart(2, "0");
  const dd = String(validDate.getDate()).padStart(2, "0");
  const hh = String(validDate.getHours()).padStart(2, "0");
  const min = String(validDate.getMinutes()).padStart(2, "0");

  return {
    id: p.id,
    episodeId: ep.id,
    episodeTitle: ep.title,
    status: p.status === "posted" ? "posted" : "pending",
    scheduledDate: { yyyy, mm, dd, hh, min },
    message: p.message,
    platformUrls: {
      apple: p.platformUrls?.apple ?? "",
      amazon: p.platformUrls?.amazon ?? "",
      spotify: p.platformUrls?.spotify ?? "",
    },
    hashtags: p.hashtags ?? [],
    generatedAt: p.generatedAt ?? ep.createdAt,
    updatedAt: p.updatedAt ?? ep.createdAt,
  };
}

export function getPostSortTimestamp(post: SNSPostItem): number {
  if (!post) return 0;
  const { yyyy, mm, dd, hh, min } = post.scheduledDate || {};
  if (yyyy && mm && dd) {
    const y = yyyy.padStart(4, "0");
    const m = mm.padStart(2, "0");
    const d = dd.padStart(2, "0");
    const h = (hh || "00").padStart(2, "0");
    const mi = (min || "00").padStart(2, "0");
    const parsed = new Date(`${y}-${m}-${d}T${h}:${mi}:00`).getTime();
    if (!isNaN(parsed)) return parsed;
  }
  const gen = post.generatedAt ? new Date(post.generatedAt).getTime() : 0;
  return isNaN(gen) ? 0 : gen;
}

export function sortPostsDesc(posts: SNSPostItem[]): SNSPostItem[] {
  if (!Array.isArray(posts)) return [];
  return [...posts].sort((a, b) => {
    const diff = getPostSortTimestamp(b) - getPostSortTimestamp(a);
    if (diff !== 0) return diff;
    return (b.id || "").localeCompare(a.id || "");
  });
}
