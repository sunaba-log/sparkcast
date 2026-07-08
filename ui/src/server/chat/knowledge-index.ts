import "server-only";

import { isElasticsearchEnabled } from "@/server/chat/elasticsearch-client";
import * as elasticsearchIndex from "@/server/chat/elasticsearch-index";
import type {
  ReplaceSourceChunksInput,
  RetrievedChunk,
} from "@/server/chat/index-types";
import * as firestoreIndex from "@/server/chat/vector-index";

/**
 * ナレッジインデックスのバックエンド切り替え層。
 * ELASTICSEARCH_URL が設定されていれば Elasticsearch（ハイブリッド検索）、
 * 未設定なら従来の Firestore ベクトル検索を使う。
 */
function backend() {
  return isElasticsearchEnabled() ? elasticsearchIndex : firestoreIndex;
}

export function getIndexedSourceHash(
  podcastId: number,
  sourceKey: string,
): Promise<string | null> {
  return backend().getIndexedSourceHash(podcastId, sourceKey);
}

export function listIndexedSourceKeys(podcastId: number): Promise<string[]> {
  return backend().listIndexedSourceKeys(podcastId);
}

export function deleteSourceChunks(
  podcastId: number,
  sourceKey: string,
): Promise<void> {
  return backend().deleteSourceChunks(podcastId, sourceKey);
}

export function replaceSourceChunks(
  input: ReplaceSourceChunksInput,
): Promise<void> {
  return backend().replaceSourceChunks(input);
}

/**
 * クエリに関連するナレッジチャンクを横断検索する。
 * Elasticsearch では BM25 + kNN のハイブリッド、Firestore ではベクトル検索のみ。
 */
export function searchRelevantChunks(
  podcastId: number,
  query: { text: string; vector: number[] },
  limit: number,
): Promise<RetrievedChunk[]> {
  if (isElasticsearchEnabled()) {
    return elasticsearchIndex.searchHybridChunks(
      podcastId,
      query.text,
      query.vector,
      limit,
    );
  }
  return firestoreIndex.searchSimilarChunks(podcastId, query.vector, limit);
}
