import "server-only";

import type { QueryResultRow } from "pg";
import { getDbPool } from "@/server/db";
import { getAdminFirestore } from "@/server/firebase-admin";
import type {
  Episode,
  DirectorIntervention,
  DirectorInterventionStatus,
  EpisodePromotion,
  EpisodeStatus,
  PolicyFinding,
  PolicyFindingStatus,
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
  published_at: Date | null;
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

type FirestoreDirectorIntervention = {
  chunk_id?: string;
  target_speaker?: string;
  insert_timestamp_ms?: number;
  correction_script?: string;
  audit_metrics?: {
    score?: number;
    choice?: string;
  };
  status?: string;
};

type FirestorePolicyFinding = {
  chunk_id?: string;
  category?: string;
  source?: string;
  start_ms?: number;
  end_ms?: number;
  text?: string;
  entity_type?: string | null;
  action?: string;
  status?: string;
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

  promotions.sort((a, b) => {
    const timeA = new Date(a.scheduledTime || a.generatedAt).getTime();
    const timeB = new Date(b.scheduledTime || b.generatedAt).getTime();
    const diff = (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
    if (diff !== 0) return diff;
    return (b.id || "").localeCompare(a.id || "");
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

function toDirectorIntervention(
  id: string,
  data: FirestoreDirectorIntervention,
  sourceText: string,
): DirectorIntervention {
  const severity = Math.min(5, Math.max(1, Math.round(Number(data.audit_metrics?.score ?? 1)))) as 1 | 2 | 3 | 4 | 5;
  const status: DirectorInterventionStatus =
    data.status === "approved" || data.status === "rejected" ? data.status : "pending";
  return {
    id,
    insertAt: Number(data.insert_timestamp_ms ?? 0) / 1_000,
    sourceText,
    speaker: String(data.target_speaker ?? ""),
    severity,
    category: String(data.audit_metrics?.choice ?? "other"),
    correctionScript: String(data.correction_script ?? ""),
    status,
  };
}

export async function listDirectorInterventions(
  podcastId: number,
  episodeId: number,
): Promise<DirectorIntervention[]> {
  const contentRef = episodeContentRef(podcastId, episodeId);
  const [interventionsSnapshot, transcriptsSnapshot] = await Promise.all([
    contentRef.collection("director_interventions").get(),
    contentRef.collection("transcripts").get(),
  ]);
  const sourceTextByChunkId = new Map(
    transcriptsSnapshot.docs.map((document) => [
      document.id,
      String(document.data().text ?? ""),
    ]),
  );
  return interventionsSnapshot.docs
    .map((document) => {
      const data = document.data() as FirestoreDirectorIntervention;
      return toDirectorIntervention(
        document.id,
        data,
        sourceTextByChunkId.get(String(data.chunk_id ?? "")) ?? "",
      );
    })
    .sort((left, right) => left.insertAt - right.insertAt);
}

export async function updateDirectorInterventions(input: {
  podcastId: number;
  episodeId: number;
  interventions: Array<Pick<DirectorIntervention, "id" | "correctionScript" | "status">>;
  updatedBy: string;
}): Promise<void> {
  const batch = getAdminFirestore().batch();
  const collection = episodeContentRef(input.podcastId, input.episodeId)
    .collection("director_interventions");
  for (const intervention of input.interventions) {
    batch.set(
      collection.doc(intervention.id),
      {
        correction_script: intervention.correctionScript,
        status: intervention.status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: input.updatedBy,
      },
      { merge: true },
    );
  }
  await batch.commit();
}

function toPolicyFinding(id: string, data: FirestorePolicyFinding): PolicyFinding {
  const category =
    data.category === "pii" || data.category === "confidential_information" || data.category === "third_party_risk"
      ? data.category
      : "pii";
  const source = data.source === "jev" ? "jev" : "presidio";
  const status: PolicyFindingStatus =
    data.status === "approved" || data.status === "rejected" ? data.status : "pending";
  return {
    id,
    chunkId: String(data.chunk_id ?? ""),
    category,
    source,
    start: Number(data.start_ms ?? 0) / 1_000,
    end: Number(data.end_ms ?? 0) / 1_000,
    text: String(data.text ?? ""),
    entityType: data.entity_type ? String(data.entity_type) : null,
    action: "silence",
    status,
  };
}

export async function listPolicyFindings(
  podcastId: number,
  episodeId: number,
): Promise<PolicyFinding[]> {
  const snapshot = await episodeContentRef(podcastId, episodeId)
    .collection("policy_findings")
    .get();
  return snapshot.docs
    .map((document) => toPolicyFinding(document.id, document.data() as FirestorePolicyFinding))
    .sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
}

export async function updatePolicyFindings(input: {
  podcastId: number;
  episodeId: number;
  findings: Array<Pick<PolicyFinding, "id" | "status">>;
  updatedBy: string;
}): Promise<void> {
  const batch = getAdminFirestore().batch();
  const collection = episodeContentRef(input.podcastId, input.episodeId)
    .collection("policy_findings");
  for (const finding of input.findings) {
    batch.set(
      collection.doc(finding.id),
      {
        status: finding.status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: input.updatedBy,
      },
      { merge: true },
    );
  }
  await batch.commit();
}

export async function markEpisodeEditing(
  podcastId: number,
  episodeId: number,
): Promise<boolean> {
  const result = await (await getDbPool()).query(
    `UPDATE episodes
     SET status = 'editing', processing_error = NULL, updated_at = now()
     WHERE podcast_id = $1 AND episode_id = $2 AND status = 'awaiting_approval'`,
    [podcastId, episodeId],
  );
  return result.rowCount === 1;
}

export async function markEpisodeAwaitingPublishConfirmation(
  podcastId: number,
  episodeId: number,
): Promise<boolean> {
  const result = await (await getDbPool()).query(
    `UPDATE episodes
     SET status = 'awaiting_publish_confirmation', processing_error = NULL, updated_at = now()
     WHERE podcast_id = $1 AND episode_id = $2 AND status = 'awaiting_approval'`,
    [podcastId, episodeId],
  );
  return result.rowCount === 1;
}

export async function markEpisodePublishingOriginal(
  podcastId: number,
  episodeId: number,
): Promise<boolean> {
  const result = await (await getDbPool()).query(
    `UPDATE episodes
     SET status = 'processing', processing_error = NULL, updated_at = now()
     WHERE podcast_id = $1 AND episode_id = $2 AND status = 'awaiting_publish_confirmation'`,
    [podcastId, episodeId],
  );
  return result.rowCount === 1;
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
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    isPublished: Boolean(row.published_at && row.status === "completed"),
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
            audio_file_path, status, processing_error, created_at, published_at, artwork_url
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
            audio_file_path, status, processing_error, created_at, published_at, artwork_url
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
            audio_file_path, status, processing_error, created_at, published_at, artwork_url
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

  await docRef.set(updateData, { merge: true });
}

export async function deleteSnsPromotion(input: {
  podcastId: number;
  episodeId: number;
  promotionId: string;
}): Promise<void> {
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

export async function setEpisodePublished(
  podcastId: number,
  episodeId: number,
  published: boolean,
): Promise<boolean> {
  const result = await (await getDbPool()).query(
    `UPDATE episodes
     SET published_at = $1, updated_at = now()
     WHERE podcast_id = $2 AND episode_id = $3`,
    [published ? new Date() : null, podcastId, episodeId],
  );
  return result.rowCount === 1;
}

export async function deleteEpisodeRecord(
  podcastId: number,
  episodeId: number,
): Promise<boolean> {
  const pool = await getDbPool();
  const result = await pool.query(
    `DELETE FROM episodes
     WHERE podcast_id = $1 AND episode_id = $2`,
    [podcastId, episodeId],
  );

  // Firestore 内のコンテンツもクリーンアップ
  try {
    const contentRef = episodeContentRef(podcastId, episodeId);
    await contentRef.delete();
  } catch (error) {
    console.warn(`Failed to delete firestore episode content for ${episodeId}:`, error);
  }

  return result.rowCount === 1;
}

export async function markEpisodeAuditing(
  podcastId: number,
  episodeId: number,
): Promise<boolean> {
  const result = await (await getDbPool()).query(
    `UPDATE episodes
     SET status = 'auditing', processing_error = NULL, updated_at = now()
     WHERE podcast_id = $1 AND episode_id = $2`,
    [podcastId, episodeId],
  );
  return result.rowCount === 1;
}

export async function updateEpisodeMetadata(
  podcastId: number,
  episodeId: number,
  title?: string,
  description?: string,
): Promise<boolean> {
  if (title === undefined && description === undefined) return true;
  const result = await (await getDbPool()).query(
    `UPDATE episodes
     SET title = COALESCE($1, title),
         description = COALESCE($2, description),
         updated_at = now()
     WHERE podcast_id = $3 AND episode_id = $4`,
    [title ?? null, description ?? null, podcastId, episodeId],
  );
  return result.rowCount === 1;
}
