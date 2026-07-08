import type { KnowledgeSourceType } from "@/server/chat/knowledge-types";

/** インデックスへ書き込む 1 チャンク分のテキスト。 */
export type IndexChunk = {
  chunkIndex: number;
  text: string;
};

/** 横断検索で取得したナレッジチャンク。 */
export type RetrievedChunk = {
  sourceType: KnowledgeSourceType;
  sourceKey: string;
  title: string;
  url: string;
  text: string;
};

/** 1 ソース分のチャンク入れ替え入力。 */
export type ReplaceSourceChunksInput = {
  podcastId: number;
  sourceType: KnowledgeSourceType;
  sourceKey: string;
  title: string;
  url: string;
  contentHash: string;
  chunks: IndexChunk[];
  embeddings: number[][];
};
