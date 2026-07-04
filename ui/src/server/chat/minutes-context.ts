import type { EpisodeKnowledge } from "@/server/chat/minutes-repository";
import type { RetrievedChunk } from "@/server/chat/vector-index";

export type BuildMinutesContextOptions = {
  /** コンテキスト全体の最大文字数。 */
  maxTotalChars?: number;
  /** 1 エピソードあたりの最大文字数。 */
  maxPerEpisodeChars?: number;
};

const DEFAULT_MAX_TOTAL_CHARS = 120_000;
const DEFAULT_MAX_PER_EPISODE_CHARS = 6_000;

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…（以下省略）`;
}

/**
 * 配信済みエピソードの議事録を LLM へ渡すコンテキスト文字列に整形する。
 * 新しい順に詰め、全体予算を超えた時点で打ち切る（純粋関数）。
 */
export function buildMinutesContext(
  items: EpisodeKnowledge[],
  options: BuildMinutesContextOptions = {},
): string {
  const maxTotal = options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
  const maxPerEpisode = options.maxPerEpisodeChars ?? DEFAULT_MAX_PER_EPISODE_CHARS;

  const blocks: string[] = [];
  let used = 0;

  for (const item of items) {
    const body = truncate(item.content, maxPerEpisode);
    if (!body) continue;
    const block = `## エピソード ${item.episodeId}: ${item.title}\n${body}`;
    if (used + block.length > maxTotal) break;
    blocks.push(block);
    used += block.length;
  }

  return blocks.join("\n\n");
}

/**
 * ベクトル検索で取得したチャンクを LLM へ渡すコンテキスト文字列に整形する。
 * 同一エピソードのチャンクはまとめ、全体予算を超えた時点で打ち切る（純粋関数）。
 */
export function buildRetrievedContext(
  chunks: RetrievedChunk[],
  options: { maxTotalChars?: number } = {},
): string {
  const maxTotal = options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;

  const byEpisode = new Map<number, { title: string; texts: string[] }>();
  for (const chunk of chunks) {
    const text = chunk.text.trim();
    if (!text) continue;
    const entry = byEpisode.get(chunk.episodeId);
    if (entry) {
      entry.texts.push(text);
    } else {
      byEpisode.set(chunk.episodeId, {
        title: chunk.episodeTitle,
        texts: [text],
      });
    }
  }

  const blocks: string[] = [];
  let used = 0;
  for (const [episodeId, { title, texts }] of byEpisode) {
    const block = `## エピソード ${episodeId}: ${title}\n${texts.join("\n…\n")}`;
    if (used + block.length > maxTotal) break;
    blocks.push(block);
    used += block.length;
  }

  return blocks.join("\n\n");
}
