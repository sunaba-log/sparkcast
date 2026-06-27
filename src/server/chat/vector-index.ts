import "server-only";

import {
  type CollectionReference,
  FieldValue,
} from "firebase-admin/firestore";
import { getAdminFirestore } from "@/server/firebase-admin";

const INDEX_COLLECTION = "minutes_index";
const META_COLLECTION = "minutes_index_meta";
const MAX_BATCH_OPS = 450;

export type IndexChunk = {
  chunkIndex: number;
  text: string;
};

export type RetrievedChunk = {
  episodeId: number;
  episodeTitle: string;
  text: string;
};

function indexCollection(podcastId: number): CollectionReference {
  return getAdminFirestore()
    .collection("podcasts")
    .doc(String(podcastId))
    .collection(INDEX_COLLECTION);
}

function metaDoc(podcastId: number, episodeId: number) {
  return getAdminFirestore()
    .collection("podcasts")
    .doc(String(podcastId))
    .collection(META_COLLECTION)
    .doc(String(episodeId));
}

/** 既にインデックス済みエピソードの議事録ハッシュ（未登録なら null）。 */
export async function getIndexedEpisodeHash(
  podcastId: number,
  episodeId: number,
): Promise<string | null> {
  const snapshot = await metaDoc(podcastId, episodeId).get();
  const hash = snapshot.data()?.content_hash;
  return typeof hash === "string" ? hash : null;
}

/**
 * 1 エピソード分のチャンクを入れ替える。既存チャンクを削除して新しい埋め込みを書き込み、
 * メタ（ハッシュ）を更新する。
 */
export async function replaceEpisodeChunks(input: {
  podcastId: number;
  episodeId: number;
  episodeTitle: string;
  contentHash: string;
  chunks: IndexChunk[];
  embeddings: number[][];
}): Promise<void> {
  const firestore = getAdminFirestore();
  const collection = indexCollection(input.podcastId);
  const existing = await collection
    .where("episode_id", "==", input.episodeId)
    .get();

  let batch = firestore.batch();
  let ops = 0;
  const flushIfNeeded = async () => {
    if (ops >= MAX_BATCH_OPS) {
      await batch.commit();
      batch = firestore.batch();
      ops = 0;
    }
  };

  for (const doc of existing.docs) {
    batch.delete(doc.ref);
    ops += 1;
    await flushIfNeeded();
  }

  const updatedAt = new Date().toISOString();
  input.chunks.forEach((chunk, position) => {
    batch.set(collection.doc(`${input.episodeId}_${chunk.chunkIndex}`), {
      episode_id: input.episodeId,
      episode_title: input.episodeTitle,
      chunk_index: chunk.chunkIndex,
      text: chunk.text,
      content_hash: input.contentHash,
      embedding: FieldValue.vector(input.embeddings[position]),
      updated_at: updatedAt,
    });
    ops += 1;
  });

  batch.set(metaDoc(input.podcastId, input.episodeId), {
    content_hash: input.contentHash,
    chunk_count: input.chunks.length,
    updated_at: updatedAt,
  });
  await batch.commit();
}

/** クエリベクトルに近い議事録チャンクを横断検索する（要・ベクトルインデックス）。 */
export async function searchSimilarChunks(
  podcastId: number,
  queryVector: number[],
  limit: number,
): Promise<RetrievedChunk[]> {
  if (queryVector.length === 0) return [];
  const snapshot = await indexCollection(podcastId)
    .findNearest({
      vectorField: "embedding",
      queryVector: FieldValue.vector(queryVector),
      limit,
      distanceMeasure: "COSINE",
    })
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      episodeId: Number(data.episode_id),
      episodeTitle: String(data.episode_title ?? ""),
      text: String(data.text ?? ""),
    };
  });
}
