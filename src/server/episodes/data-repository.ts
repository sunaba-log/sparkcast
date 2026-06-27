import "server-only";

import type { QueryResultRow } from "pg";
import { getDbPool } from "@/server/db";
import { getAdminFirestore } from "@/server/firebase-admin";
import type { Episode, EpisodePromotion, EpisodeStatus } from "@/types/episode";

type EpisodeRow = QueryResultRow & {
  episode_id: number;
  podcast_id: number;
  title: string;
  description: string | null;
  source_audio_path: string | null;
  audio_file_path: string | null;
  status: EpisodeStatus;
  processing_error: string | null;
  created_at: Date;
};

type FirestoreEpisodeContent = {
  transcript_summary?: string;
  editorial?: {
    minutes?: string;
  };
};

function audioFileName(path: string | null): string {
  return path?.split("/").at(-1) ?? "";
}

async function loadEpisodeContent(
  podcastId: number,
  episodeId: number,
): Promise<{
  minutes: string;
  promotions: EpisodePromotion[];
}> {
  const firestore = getAdminFirestore();
  const contentRef = firestore
    .collection("podcasts")
    .doc(String(podcastId))
    .collection("episodes_contents")
    .doc(String(episodeId));
  const [contentSnapshot, transcriptSnapshot, promotionsSnapshot] =
    await Promise.all([
      contentRef.get(),
      contentRef.collection("transcripts").orderBy("chunk_id").get(),
      contentRef.collection("sns_promotions").get(),
    ]);

  const content = contentSnapshot.data() as FirestoreEpisodeContent | undefined;
  const generatedTranscript = transcriptSnapshot.docs
    .map((document) => String(document.data().text ?? ""))
    .filter(Boolean)
    .join("\n\n");
  const minutes =
    content?.editorial?.minutes ||
    generatedTranscript ||
    content?.transcript_summary ||
    "";
  const promotions = promotionsSnapshot.docs.map((document) => {
    const data = document.data();
    return {
      id: document.id,
      message: String(data.message ?? ""),
      status: String(data.status ?? "pending"),
      scheduledTime: data.scheduled_time
        ? String(data.scheduled_time)
        : null,
    };
  });

  return { minutes, promotions };
}

function toEpisode(
  row: EpisodeRow,
  content: { minutes: string; promotions: EpisodePromotion[] },
): Episode {
  return {
    id: String(row.episode_id),
    podcastId: row.podcast_id,
    title: row.title,
    description: row.description ?? "",
    createdAt: row.created_at.toISOString(),
    status: row.status,
    audioFileName: audioFileName(row.source_audio_path ?? row.audio_file_path),
    audioUrl: row.status === "completed" ? row.audio_file_path : null,
    processingError: row.processing_error,
    minutesGenerated: Boolean(content.minutes),
    xPostsGenerated: content.promotions.length > 0,
    seedsGenerated: false,
    minutes: content.minutes,
    xPosts: content.promotions,
    conversationSeeds: [],
  };
}

export async function listEpisodes(podcastId: number): Promise<Episode[]> {
  const result = await (await getDbPool()).query<EpisodeRow>(
    `SELECT episode_id, podcast_id, title, description, source_audio_path,
            audio_file_path, status, processing_error, created_at
     FROM episodes
     WHERE podcast_id = $1
     ORDER BY created_at DESC`,
    [podcastId],
  );
  return Promise.all(
    result.rows.map(async (row) =>
      toEpisode(row, await loadEpisodeContent(row.podcast_id, row.episode_id)),
    ),
  );
}

export async function findEpisode(
  podcastId: number,
  episodeId: number,
): Promise<Episode | null> {
  const result = await (await getDbPool()).query<EpisodeRow>(
    `SELECT episode_id, podcast_id, title, description, source_audio_path,
            audio_file_path, status, processing_error, created_at
     FROM episodes
     WHERE podcast_id = $1 AND episode_id = $2`,
    [podcastId, episodeId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return toEpisode(row, await loadEpisodeContent(row.podcast_id, row.episode_id));
}

export async function updateEpisodeGeneratedContent(input: {
  podcastId: number;
  episodeId: number;
  minutes?: string;
  promotions?: Array<{ id: string; message: string }>;
  updatedBy: string;
}): Promise<void> {
  const firestore = getAdminFirestore();
  const contentRef = firestore
    .collection("podcasts")
    .doc(String(input.podcastId))
    .collection("episodes_contents")
    .doc(String(input.episodeId));
  const writes: Array<Promise<FirebaseFirestore.WriteResult>> = [];

  if (input.minutes !== undefined) {
    writes.push(
      contentRef.set(
        {
          editorial: {
            minutes: input.minutes,
            updated_at: new Date().toISOString(),
            updated_by: input.updatedBy,
          },
        },
        { merge: true },
      ),
    );
  }
  for (const promotion of input.promotions ?? []) {
    writes.push(
      contentRef
        .collection("sns_promotions")
        .doc(promotion.id)
        .set(
          {
            message: promotion.message,
            edited_at: new Date().toISOString(),
            edited_by: input.updatedBy,
          },
          { merge: true },
        ),
    );
  }
  await Promise.all(writes);
}
