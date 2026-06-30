import "server-only";
import { getDbPool } from "@/server/db";

export type Podcast = {
  id: number;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  rssFeedPath: string | null;
};

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
