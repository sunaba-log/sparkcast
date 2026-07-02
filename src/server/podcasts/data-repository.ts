import "server-only";
import { getDbPool } from "@/server/db";
import type { PodcastSummary } from "@/types/podcast";

export type Podcast = {
  id: number;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  rssFeedPath: string | null;
};

const DEFAULT_COVER_IMAGE_URL = "/images/default-podcast-cover.png";

export async function getPodcast(podcastId: number): Promise<Podcast | null> {
  const result = await (await getDbPool()).query(
    `SELECT podcast_id, title, description, cover_image_url, rss_feed_path
     FROM podcasts
     WHERE podcast_id = $1`,
    [podcastId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.podcast_id,
    title: row.title,
    description: row.description,
    coverImageUrl: row.cover_image_url,
    rssFeedPath: row.rss_feed_path,
  };
}

export async function listPodcastsForUser(
  userId: string,
): Promise<PodcastSummary[]> {
  const result = await (await getDbPool()).query(
    `SELECT p.podcast_id, p.title, p.description, p.cover_image_url, p.rss_feed_path, o.role
     FROM podcasts p
     JOIN podcast_ownerships o ON o.podcast_id = p.podcast_id
     WHERE o.user_id = $1
       AND o.role IN ('owner', 'editor')
     ORDER BY p.podcast_id`,
    [userId]
  );
  return result.rows.map((row) => ({
    id: row.podcast_id,
    title: row.title,
    description: row.description,
    coverImageUrl: row.cover_image_url,
    rssFeedPath: row.rss_feed_path,
    role: row.role,
  }));
}

export async function listAllPodcastIds(): Promise<number[]> {
  const result = await (await getDbPool()).query(
    `SELECT podcast_id FROM podcasts ORDER BY podcast_id`
  );
  return result.rows.map((row) => row.podcast_id);
}

export async function createPodcast(input: {
  title: string;
  description: string | null;
  ownerUserId: string;
}): Promise<Podcast> {
  const client = await (await getDbPool()).connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO podcasts (title, description, cover_image_url)
       VALUES ($1, $2, $3)
       RETURNING podcast_id, title, description, cover_image_url, rss_feed_path`,
      [input.title, input.description, DEFAULT_COVER_IMAGE_URL]
    );
    const row = inserted.rows[0];
    await client.query(
      `INSERT INTO podcast_ownerships (podcast_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [row.podcast_id, input.ownerUserId]
    );
    await client.query("COMMIT");
    return {
      id: row.podcast_id,
      title: row.title,
      description: row.description,
      coverImageUrl: row.cover_image_url,
      rssFeedPath: row.rss_feed_path,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
