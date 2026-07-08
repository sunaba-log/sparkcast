import "server-only";

import type {
  BulkOperationContainer,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import { getElasticsearchClient } from "@/server/chat/elasticsearch-client";
import type {
  ReplaceSourceChunksInput,
  RetrievedChunk,
} from "@/server/chat/index-types";
import type { KnowledgeSourceType } from "@/server/chat/knowledge-types";
import { fuseReciprocalRank } from "@/server/chat/rrf";
import { getElasticsearchIndex } from "@/server/env";

/** Vertex AI text embedding の次元数（Firestore ベクトルインデックスと同一）。 */
const EMBEDDING_DIMENSION = 768;
/** kNN の探索候補数の係数。limit に掛けて num_candidates を決める。 */
const KNN_CANDIDATE_FACTOR = 10;
/** listIndexedSourceKeys で取得する meta ドキュメントの上限。 */
const MAX_SOURCE_KEYS = 10_000;

type IndexedDoc = {
  kind: "chunk" | "meta";
  podcast_id: number;
  source_type: KnowledgeSourceType;
  source_key: string;
  title?: string;
  url?: string;
  chunk_index?: number;
  text?: string;
  content_hash: string;
  embedding?: number[];
  updated_at: string;
};

function chunkDocId(
  podcastId: number,
  sourceKey: string,
  chunkIndex: number,
): string {
  return `p${podcastId}_${sourceKey}_${chunkIndex}`;
}

function metaDocId(podcastId: number, sourceKey: string): string {
  return `meta_p${podcastId}_${sourceKey}`;
}

let ensureIndexPromise: Promise<void> | null = null;

/**
 * インデックスが無ければマッピング付きで作成する（初回のみ実行・以後キャッシュ）。
 * text 系フィールドは kuromoji アナライザ（analysis-kuromoji プラグイン）で解析する。
 */
async function ensureIndex(): Promise<void> {
  if (!ensureIndexPromise) {
    ensureIndexPromise = createIndexIfMissing().catch((error) => {
      ensureIndexPromise = null;
      throw error;
    });
  }
  return ensureIndexPromise;
}

async function createIndexIfMissing(): Promise<void> {
  const client = getElasticsearchClient();
  const index = getElasticsearchIndex();
  if (await client.indices.exists({ index })) return;

  try {
    await client.indices.create({
      index,
      mappings: {
        properties: {
          kind: { type: "keyword" },
          podcast_id: { type: "long" },
          source_type: { type: "keyword" },
          source_key: { type: "keyword" },
          title: { type: "text", analyzer: "kuromoji" },
          url: { type: "keyword", index: false },
          chunk_index: { type: "integer" },
          text: { type: "text", analyzer: "kuromoji" },
          content_hash: { type: "keyword" },
          embedding: {
            type: "dense_vector",
            dims: EMBEDDING_DIMENSION,
            index: true,
            similarity: "cosine",
          },
          updated_at: { type: "date" },
        },
      },
    });
  } catch (error) {
    // 並行リクエストが先に作成した場合は成功扱いにする。
    const type = (
      error as { meta?: { body?: { error?: { type?: string } } } }
    ).meta?.body?.error?.type;
    if (type !== "resource_already_exists_exception") throw error;
  }
}

function sourceFilter(
  podcastId: number,
  sourceKey: string,
): QueryDslQueryContainer {
  return {
    bool: {
      filter: [
        { term: { podcast_id: podcastId } },
        { term: { source_key: sourceKey } },
      ],
    },
  };
}

/** 既にインデックス済みソースのコンテンツハッシュ（未登録なら null）。 */
export async function getIndexedSourceHash(
  podcastId: number,
  sourceKey: string,
): Promise<string | null> {
  await ensureIndex();
  const response = await getElasticsearchClient().get<IndexedDoc>(
    { index: getElasticsearchIndex(), id: metaDocId(podcastId, sourceKey) },
    { ignore: [404] },
  );
  const hash = response.found ? response._source?.content_hash : null;
  return typeof hash === "string" ? hash : null;
}

/** インデックス済みの全ソースキー（meta ドキュメント）。 */
export async function listIndexedSourceKeys(
  podcastId: number,
): Promise<string[]> {
  await ensureIndex();
  const response = await getElasticsearchClient().search<IndexedDoc>({
    index: getElasticsearchIndex(),
    size: MAX_SOURCE_KEYS,
    _source: ["source_key"],
    query: {
      bool: {
        filter: [{ term: { kind: "meta" } }, { term: { podcast_id: podcastId } }],
      },
    },
  });
  return response.hits.hits
    .map((hit) => hit._source?.source_key)
    .filter((key): key is string => typeof key === "string");
}

/** 1 ソース分のチャンクと meta を削除する。 */
export async function deleteSourceChunks(
  podcastId: number,
  sourceKey: string,
): Promise<void> {
  await ensureIndex();
  await getElasticsearchClient().deleteByQuery({
    index: getElasticsearchIndex(),
    query: sourceFilter(podcastId, sourceKey),
    conflicts: "proceed",
    refresh: true,
  });
}

/**
 * 1 ソース分のチャンクを入れ替える。既存チャンクを削除して新しい埋め込みを書き込み、
 * meta（ハッシュ）を更新する。
 */
export async function replaceSourceChunks(
  input: ReplaceSourceChunksInput,
): Promise<void> {
  await ensureIndex();
  const client = getElasticsearchClient();
  const index = getElasticsearchIndex();

  await client.deleteByQuery({
    index,
    query: sourceFilter(input.podcastId, input.sourceKey),
    conflicts: "proceed",
    refresh: true,
  });

  const updatedAt = new Date().toISOString();
  const operations: (BulkOperationContainer | IndexedDoc)[] =
    input.chunks.flatMap((chunk, position) => [
    {
      index: {
        _index: index,
        _id: chunkDocId(input.podcastId, input.sourceKey, chunk.chunkIndex),
      },
    },
    {
      kind: "chunk",
      podcast_id: input.podcastId,
      source_type: input.sourceType,
      source_key: input.sourceKey,
      title: input.title,
      url: input.url,
      chunk_index: chunk.chunkIndex,
      text: chunk.text,
      content_hash: input.contentHash,
      embedding: input.embeddings[position],
      updated_at: updatedAt,
    } satisfies IndexedDoc,
  ]);
  operations.push(
    {
      index: {
        _index: index,
        _id: metaDocId(input.podcastId, input.sourceKey),
      },
    },
    {
      kind: "meta",
      podcast_id: input.podcastId,
      source_type: input.sourceType,
      source_key: input.sourceKey,
      content_hash: input.contentHash,
      updated_at: updatedAt,
    } satisfies IndexedDoc,
  );

  const response = await client.bulk({ operations, refresh: "wait_for" });
  if (response.errors) {
    const reasons = response.items
      .map((item) => item.index?.error?.reason)
      .filter(Boolean)
      .slice(0, 3);
    throw new Error(`Elasticsearch bulk index failed: ${reasons.join(" / ")}`);
  }
}

function toRetrievedChunk(source: IndexedDoc): RetrievedChunk {
  return {
    sourceType: source.source_type,
    sourceKey: source.source_key,
    title: source.title ?? "",
    url: source.url ?? "",
    text: source.text ?? "",
  };
}

/**
 * BM25（kuromoji）と dense vector kNN を RRF で融合するハイブリッド検索。
 * クエリベクトルが空のときは BM25 のみ、クエリ文が空のときは kNN のみで検索する。
 */
export async function searchHybridChunks(
  podcastId: number,
  queryText: string,
  queryVector: number[],
  limit: number,
): Promise<RetrievedChunk[]> {
  const text = queryText.trim();
  if (!text && queryVector.length === 0) return [];
  await ensureIndex();
  const client = getElasticsearchClient();
  const index = getElasticsearchIndex();
  const chunkFilter: QueryDslQueryContainer[] = [
    { term: { kind: "chunk" } },
    { term: { podcast_id: podcastId } },
  ];

  type RankedHit = { id: string; chunk: RetrievedChunk };
  const toRankedHits = (response: {
    hits: { hits: { _id?: string; _source?: IndexedDoc }[] };
  }): RankedHit[] =>
    response.hits.hits.flatMap((hit) =>
      hit._source && hit._id
        ? [{ id: hit._id, chunk: toRetrievedChunk(hit._source) }]
        : [],
    );

  const searches: Promise<RankedHit[]>[] = [];
  if (text) {
    searches.push(
      client
        .search<IndexedDoc>({
          index,
          size: limit,
          query: {
            bool: {
              filter: chunkFilter,
              must: [{ match: { text } }],
            },
          },
        })
        .then(toRankedHits),
    );
  }
  if (queryVector.length > 0) {
    searches.push(
      client
        .search<IndexedDoc>({
          index,
          size: limit,
          knn: {
            field: "embedding",
            query_vector: queryVector,
            k: limit,
            num_candidates: limit * KNN_CANDIDATE_FACTOR,
            filter: { bool: { filter: chunkFilter } },
          },
        })
        .then(toRankedHits),
    );
  }

  const rankings = await Promise.all(searches);
  return fuseReciprocalRank(rankings, (hit) => hit.id, limit).map(
    (hit) => hit.chunk,
  );
}
