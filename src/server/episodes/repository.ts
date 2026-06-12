import "server-only";

import type { PoolClient } from "pg";

type CreateEpisodeRecordInput = {
  podcastId: number;
  title: string;
  description?: string;
};

export async function createEpisodeRecord(
  client: PoolClient,
  input: CreateEpisodeRecordInput,
): Promise<number> {
  const result = await client.query<{ episode_id: number }>(
    `INSERT INTO episodes (podcast_id, title, description, audio_file_path)
     VALUES ($1, $2, $3, '')
     RETURNING episode_id`,
    [input.podcastId, input.title, input.description ?? null],
  );
  return result.rows[0].episode_id;
}

export async function setEpisodeAudioFilePath(
  client: PoolClient,
  episodeId: number,
  objectPath: string,
): Promise<void> {
  await client.query(
    "UPDATE episodes SET audio_file_path = $1 WHERE episode_id = $2",
    [objectPath, episodeId],
  );
}

