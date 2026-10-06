import "server-only";

import type { QueryResultRow } from "pg";
import { getDbPool } from "@/server/db";
import { getAdminFirestore } from "@/server/firebase-admin";
import type {
  Episode,
  EpisodePromotion,
  EpisodeStatus,
  TranscriptSegment,
} from "@/types/episode";

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
  artwork_url: string | null;
};

type FirestoreEpisodeContent = {
  transcript_summary?: string;
  // AI が作った議事録（#166 以降。それ以前は transcripts に議事録を分割して入れていた）
  minutes?: string;
  transcript_meta?: {
    engine?: string;
    speaker_source?: string;
    segment_count?: number;
  };
  editorial?: {
    minutes?: string;
  };
};

type EpisodeContent = {
  minutes: string;
  transcriptAvailable: boolean;
  promotions: EpisodePromotion[];
};

function audioFileName(path: string | null): string {
  return path?.split("/").at(-1) ?? "";
}

async function loadEpisodeContent(
  podcastId: number,
  episodeId: number,
): Promise<EpisodeContent> {
  const contentRef = episodeContentRef(podcastId, episodeId);
  const [contentSnapshot, promotionsSnapshot] = await Promise.all([
    contentRef.get(),
    contentRef.collection("sns_promotions").get(),
  ]);

  const content = contentSnapshot.data() as FirestoreEpisodeContent | undefined;
  // 以前の形式（transcripts に議事録を分割して保存）のときだけ、transcripts を議事録として連結する。
  // 新しい形式では transcripts は発話ごと（数百件）なので、一覧のたびに読まない。
  let legacyMinutes = "";
  if (!content?.editorial?.minutes && !content?.minutes) {
    const transcriptSnapshot = await contentRef
      .collection("transcripts")
      .orderBy("chunk_id")
      .get();
    legacyMinutes = transcriptSnapshot.docs
      .map((document) => String(document.data().text ?? ""))
      .filter(Boolean)
      .join("\n\n");
  }
  const minutes =
    content?.editorial?.minutes ||
    content?.minutes ||
    legacyMinutes ||
    content?.transcript_summary ||
    "";
  const transcriptAvailable = (content?.transcript_meta?.segment_count ?? 0) > 0;
  const promotions = promotionsSnapshot.docs.map((document) => {
    const data = document.data();
    return {
      id: document.id,
      message: String(data.message ?? ""),
      status: String(data.status ?? "pending"),
      scheduledTime: data.scheduled_time
        ? String(data.scheduled_time)
        : null,
      platformUrls: {
        apple: String(data.platform_urls?.apple ?? ""),
        amazon: String(data.platform_urls?.amazon ?? ""),
        spotify: String(data.platform_urls?.spotify ?? ""),
      },
      hashtags: Array.isArray(data.hashtags)
        ? data.hashtags.map(String)
        : [],
      generatedAt: data.generated_at ? String(data.generated_at) : new Date().toISOString(),
      updatedAt: data.edited_at ? String(data.edited_at) : (data.generated_at ? String(data.generated_at) : new Date().toISOString()),
    };
  });

  return { minutes, transcriptAvailable, promotions };
}

function episodeContentRef(podcastId: number, episodeId: number) {
  return getAdminFirestore()
    .collection("podcasts")
    .doc(String(podcastId))
    .collection("episodes_contents")
    .doc(String(episodeId));
}

// 話者・時刻つきの文字起こし（#166）。時刻順（seg_00001...）。
export async function listTranscriptSegments(
  podcastId: number,
  episodeId: number,
): Promise<TranscriptSegment[]> {
  const snapshot = await episodeContentRef(podcastId, episodeId)
    .collection("transcripts")
    .orderBy("chunk_id")
    .get();
  return snapshot.docs
    .map((document) => {
      const data = document.data();
      return {
        id: document.id,
        start: Number(data.start_time ?? 0),
        end: Number(data.end_time ?? 0),
        speaker: String(data.speaker ?? ""),
        speakerId: data.speaker_id ? String(data.speaker_id) : null,
        text: String(data.text ?? ""),
      };
    })
    .filter((segment) => segment.text.trim().length > 0);
}

function toEpisode(row: EpisodeRow, content: EpisodeContent): Episode {
  return {
    id: String(row.episode_id),
    podcastId: row.podcast_id,
    title: row.title,
    description: row.description ?? "",
    createdAt: row.created_at.toISOString(),
    status: row.status,
    audioFileName: audioFileName(row.source_audio_path ?? row.audio_file_path),
    audioUrl: row.status === "completed" ? row.audio_file_path : null,
    artworkUrl: row.artwork_url || null,
    processingError: row.processing_error,
    minutesGenerated: Boolean(content.minutes),
    transcriptAvailable: content.transcriptAvailable,
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
            audio_file_path, status, processing_error, created_at, artwork_url
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
            audio_file_path, status, processing_error, created_at, artwork_url
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

export async function listEpisodesAndPromotionsPaginated(
  podcastId: number,
  limit: number,
  offset: number,
): Promise<{ episodes: Episode[]; hasMore: boolean }> {
  const pool = await getDbPool();

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM episodes WHERE podcast_id = $1`,
    [podcastId]
  );
  const totalCount = parseInt(countResult.rows[0].count, 10);

  const result = await pool.query<EpisodeRow>(
    `SELECT episode_id, podcast_id, title, description, source_audio_path,
            audio_file_path, status, processing_error, created_at, artwork_url
     FROM episodes
     WHERE podcast_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [podcastId, limit, offset],
  );

  const episodes = await Promise.all(
    result.rows.map(async (row) =>
      toEpisode(row, await loadEpisodeContent(row.podcast_id, row.episode_id)),
    ),
  );

  const hasMore = offset + result.rows.length < totalCount;

  return { episodes, hasMore };
}

// 利用者が設定できる状態。posting / failed は自動投稿ジョブだけが書く。
const EDITABLE_SNS_STATUSES = new Set(["pending", "posted"]);

function isValidPromotionId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

export async function updateSnsPromotion(input: {
  podcastId: number;
  episodeId: number;
  promotionId: string;
  message?: string;
  status?: string;
  scheduledTime?: string | null;
  platformUrls?: { apple: string; amazon: string; spotify: string };
  hashtags?: string[];
  updatedBy: string;
}): Promise<void> {
  if (!isValidPromotionId(input.promotionId)) throw new Error("INVALID_INPUT");
  if (input.status !== undefined && !EDITABLE_SNS_STATUSES.has(input.status)) {
    throw new Error("INVALID_INPUT");
  }
  const firestore = getAdminFirestore();
  const docRef = firestore
    .collection("podcasts")
    .doc(String(input.podcastId))
    .collection("episodes_contents")
    .doc(String(input.episodeId))
    .collection("sns_promotions")
    .doc(input.promotionId);

  const updateData: Record<string, unknown> = {
    edited_at: new Date().toISOString(),
    edited_by: input.updatedBy,
  };
  if (input.message !== undefined) updateData.message = input.message;
  if (input.status !== undefined) updateData.status = input.status;
  if (input.scheduledTime !== undefined) updateData.scheduled_time = input.scheduledTime;
  if (input.platformUrls !== undefined) updateData.platform_urls = input.platformUrls;
  if (input.hashtags !== undefined) updateData.hashtags = input.hashtags;

  // 既存の投稿だけを更新する（存在しない ID で投稿予約を作らない）。
  // 送信中（posting）の投稿は状態を戻せない（自動投稿ジョブとの二重送信を防ぐ）。
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (!snapshot.exists) throw new Error("NOT_FOUND");
    const current = String(snapshot.get("status") ?? "pending");
    if (input.status !== undefined && input.status !== current && current === "posting") {
      throw new Error("CONFLICT");
    }
    transaction.update(docRef, updateData);
  });
}

export async function deleteSnsPromotion(input: {
  podcastId: number;
  episodeId: number;
  promotionId: string;
}): Promise<void> {
  if (!isValidPromotionId(input.promotionId)) throw new Error("INVALID_INPUT");
  const firestore = getAdminFirestore();
  await firestore
    .collection("podcasts")
    .doc(String(input.podcastId))
    .collection("episodes_contents")
    .doc(String(input.episodeId))
    .collection("sns_promotions")
    .doc(input.promotionId)
    .delete();
}
