import "server-only";

import type { QueryResultRow } from "pg";
import { getDbPool } from "@/server/db";
import { getAdminFirestore } from "@/server/firebase-admin";

export type EpisodeKnowledge = {
  episodeId: number;
  title: string;
  createdAt: string;
  /** 議事録テキスト（要約優先、無ければ editorial.minutes）。 */
  content: string;
};

type EpisodeRow = QueryResultRow & {
  episode_id: number;
  title: string;
  created_at: Date;
};

type FirestoreEpisodeContent = {
  transcript_summary?: string;
  editorial?: {
    minutes?: string;
  };
};

async function loadContent(
  podcastId: number,
  episodeId: number,
): Promise<string> {
  const snapshot = await getAdminFirestore()
    .collection("podcasts")
    .doc(String(podcastId))
    .collection("episodes_contents")
    .doc(String(episodeId))
    .get();
  const data = snapshot.data() as FirestoreEpisodeContent | undefined;
  return data?.editorial?.minutes || data?.transcript_summary || "";
}

/**
 * 配信済み（completed）エピソードの議事録を新しい順に取得する。
 * 議事録が空のエピソードは除外する。
 */
export async function listEpisodeKnowledge(
  podcastId: number,
): Promise<EpisodeKnowledge[]> {
  const result = await (await getDbPool()).query<EpisodeRow>(
    `SELECT episode_id, title, created_at
     FROM episodes
     WHERE podcast_id = $1 AND status = 'completed'
     ORDER BY created_at DESC`,
    [podcastId],
  );

  const items = await Promise.all(
    result.rows.map(async (row) => ({
      episodeId: row.episode_id,
      title: row.title,
      createdAt: row.created_at.toISOString(),
      content: await loadContent(podcastId, row.episode_id),
    })),
  );

  return items.filter((item) => item.content.trim().length > 0);
}
