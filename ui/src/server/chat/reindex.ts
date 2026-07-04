import "server-only";

import { createHash } from "node:crypto";
import { chunkText } from "@/server/chat/chunking";
import { embedTexts } from "@/server/chat/embeddings";
import { listEpisodeKnowledge } from "@/server/chat/minutes-repository";
import {
  getIndexedEpisodeHash,
  replaceEpisodeChunks,
} from "@/server/chat/vector-index";

export type ReindexResult = {
  episodes: number;
  indexedEpisodes: number;
  skippedEpisodes: number;
  indexedChunks: number;
};

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * 配信済みエピソードの議事録をチャンク分割・埋め込みし、Firestore ベクトルインデックスへ反映する。
 * 議事録が前回から変わっていないエピソードはスキップする（冪等）。
 */
export async function reindexPodcastMinutes(
  podcastId: number,
): Promise<ReindexResult> {
  const episodes = await listEpisodeKnowledge(podcastId);
  const result: ReindexResult = {
    episodes: episodes.length,
    indexedEpisodes: 0,
    skippedEpisodes: 0,
    indexedChunks: 0,
  };

  for (const episode of episodes) {
    const contentHash = hashContent(episode.content);
    const indexedHash = await getIndexedEpisodeHash(podcastId, episode.episodeId);
    if (indexedHash === contentHash) {
      result.skippedEpisodes += 1;
      continue;
    }

    const chunks = chunkText(episode.content);
    if (chunks.length === 0) {
      result.skippedEpisodes += 1;
      continue;
    }

    const embeddings = await embedTexts(
      chunks.map((chunk) => chunk.text),
      "RETRIEVAL_DOCUMENT",
    );

    await replaceEpisodeChunks({
      podcastId,
      episodeId: episode.episodeId,
      episodeTitle: episode.title,
      contentHash,
      chunks: chunks.map((chunk) => ({
        chunkIndex: chunk.index,
        text: chunk.text,
      })),
      embeddings,
    });

    result.indexedEpisodes += 1;
    result.indexedChunks += chunks.length;
  }

  return result;
}
