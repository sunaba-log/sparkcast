import type { Pool, PoolClient } from "pg";
import type { ParticipantRole } from "@/server/recording/tokens";

export type RecordingSessionStatus =
  | "waiting"
  | "recording"
  | "uploading"
  | "mixing"
  | "done"
  | "failed"
  | "expired";

export type RecordingSession = {
  sessionId: string;
  podcastId: number;
  hostUserId: string;
  title: string | null;
  status: RecordingSessionStatus;
  maxParticipants: number;
  recordingStartedAtMs: number | null;
  recordingStoppedAtMs: number | null;
  episodeId: number | null;
  error: string | null;
  expiresAt: Date;
  createdAt: Date;
};

export type RecordingParticipant = {
  participantId: string;
  sessionId: string;
  displayName: string;
  role: ParticipantRole;
  userId: string | null;
  removedAt: Date | null;
};

export type TrackSummary = {
  participantId: string;
  kind: "local" | "backup";
  segmentCount: number;
  chunkCount: number;
  totalBytes: number;
};

type Queryable = Pick<Pool, "query">;

type SessionRow = {
  session_id: string;
  podcast_id: number;
  host_user_id: string;
  title: string | null;
  status: RecordingSessionStatus;
  max_participants: number;
  recording_started_at_ms: string | null;
  recording_stopped_at_ms: string | null;
  episode_id: number | null;
  error: string | null;
  expires_at: Date;
  created_at: Date;
};

type ParticipantRow = {
  participant_id: string;
  session_id: string;
  display_name: string;
  role: ParticipantRole;
  user_id: string | null;
  removed_at: Date | null;
};

const SESSION_COLUMNS = `session_id, podcast_id, host_user_id, title, status, max_participants,
  recording_started_at_ms, recording_stopped_at_ms, episode_id, error, expires_at, created_at`;

const PARTICIPANT_COLUMNS = `participant_id, session_id, display_name, role, user_id, removed_at`;

// 1 セッションで作れる参加者行の上限（定員とは別。招待 URL の乱用で行が増え続けないように）
export const MAX_PARTICIPANT_ROWS_PER_SESSION = 30;

function toSession(row: SessionRow): RecordingSession {
  return {
    sessionId: row.session_id,
    podcastId: row.podcast_id,
    hostUserId: row.host_user_id,
    title: row.title,
    status: row.status,
    maxParticipants: row.max_participants,
    recordingStartedAtMs:
      row.recording_started_at_ms === null ? null : Number(row.recording_started_at_ms),
    recordingStoppedAtMs:
      row.recording_stopped_at_ms === null ? null : Number(row.recording_stopped_at_ms),
    episodeId: row.episode_id,
    error: row.error,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function toParticipant(row: ParticipantRow): RecordingParticipant {
  return {
    participantId: row.participant_id,
    sessionId: row.session_id,
    displayName: row.display_name,
    role: row.role,
    userId: row.user_id,
    removedAt: row.removed_at,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export async function createRecordingSession(
  db: Queryable,
  input: {
    podcastId: number;
    hostUserId: string;
    title: string | null;
    maxParticipants: number;
    ttlHours: number;
  },
): Promise<RecordingSession> {
  const result = await db.query<SessionRow>(
    `INSERT INTO recording_sessions
       (podcast_id, host_user_id, title, max_participants, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 hour'))
     RETURNING ${SESSION_COLUMNS}`,
    [input.podcastId, input.hostUserId, input.title, input.maxParticipants, input.ttlHours],
  );
  return toSession(result.rows[0]);
}

export async function getRecordingSession(
  db: Queryable,
  sessionId: string,
): Promise<RecordingSession | null> {
  if (!isUuid(sessionId)) return null;
  await settleExpiredSessions(db, "session_id = $1", [sessionId]);
  const result = await db.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM recording_sessions WHERE session_id = $1`,
    [sessionId],
  );
  return result.rows[0] ? toSession(result.rows[0]) : null;
}

export async function listRecordingSessions(
  db: Queryable,
  podcastId: number,
  limit = 20,
): Promise<RecordingSession[]> {
  await settleExpiredSessions(db, "podcast_id = $1", [podcastId]);
  const result = await db.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM recording_sessions
     WHERE podcast_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [podcastId, limit],
  );
  return result.rows.map(toSession);
}

export async function getParticipant(
  db: Queryable,
  participantId: string,
): Promise<RecordingParticipant | null> {
  if (!isUuid(participantId)) return null;
  const result = await db.query<ParticipantRow>(
    `SELECT ${PARTICIPANT_COLUMNS} FROM recording_participants WHERE participant_id = $1`,
    [participantId],
  );
  return result.rows[0] ? toParticipant(result.rows[0]) : null;
}

export async function listParticipants(
  db: Queryable,
  sessionId: string,
): Promise<RecordingParticipant[]> {
  const result = await db.query<ParticipantRow>(
    `SELECT ${PARTICIPANT_COLUMNS} FROM recording_participants
     WHERE session_id = $1
     ORDER BY created_at`,
    [sessionId],
  );
  return result.rows.map(toParticipant);
}

// ホストは 1 セッション 1 行。再入室では同じ行を返す。
export async function upsertHostParticipant(
  db: Queryable,
  input: { sessionId: string; userId: string; displayName: string },
): Promise<RecordingParticipant> {
  const result = await db.query<ParticipantRow>(
    `INSERT INTO recording_participants
       (session_id, display_name, role, user_id, consented_at)
     VALUES ($1, $2, 'host', $3, now())
     ON CONFLICT (session_id) WHERE role = 'host'
     DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING ${PARTICIPANT_COLUMNS}`,
    [input.sessionId, input.displayName, input.userId],
  );
  return toParticipant(result.rows[0]);
}

export class ParticipantLimitError extends Error {
  constructor() {
    super("PARTICIPANT_LIMIT");
  }
}

// ゲストを追加する。セッション行をロックして、参加者行の総数の上限を確かめてから挿入する
// （定員＝同時在室数は Durable Object 側で確かめる）。
export async function createGuestParticipant(
  client: PoolClient,
  input: { sessionId: string; displayName: string },
): Promise<RecordingParticipant> {
  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT 1 FROM recording_sessions WHERE session_id = $1 FOR UPDATE",
      [input.sessionId],
    );
    const count = await client.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM recording_participants WHERE session_id = $1",
      [input.sessionId],
    );
    if (Number(count.rows[0]?.count ?? 0) >= MAX_PARTICIPANT_ROWS_PER_SESSION) {
      throw new ParticipantLimitError();
    }
    const result = await client.query<ParticipantRow>(
      `INSERT INTO recording_participants (session_id, display_name, role, consented_at)
       VALUES ($1, $2, 'guest', now())
       RETURNING ${PARTICIPANT_COLUMNS}`,
      [input.sessionId, input.displayName],
    );
    await client.query("COMMIT");
    return toParticipant(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function updateParticipantDisplayName(
  db: Queryable,
  participantId: string,
  displayName: string,
): Promise<void> {
  await db.query(
    "UPDATE recording_participants SET display_name = $1 WHERE participant_id = $2",
    [displayName, participantId],
  );
}

export async function markParticipantRemoved(
  db: Queryable,
  sessionId: string,
  participantId: string,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE recording_participants
     SET removed_at = now()
     WHERE session_id = $1 AND participant_id = $2 AND role = 'guest' AND removed_at IS NULL`,
    [sessionId, participantId],
  );
  return result.rowCount === 1;
}

// 状態遷移は「今の状態が from のどれかなら」の条件付き UPDATE で行い、二重操作を防ぐ。
export async function transitionSessionStatus(
  db: Queryable,
  sessionId: string,
  from: RecordingSessionStatus[],
  to: RecordingSessionStatus,
  fields: {
    recordingStartedAtMs?: number;
    recordingStoppedAtMs?: number;
    episodeId?: number;
    error?: string | null;
  } = {},
): Promise<RecordingSession | null> {
  const result = await db.query<SessionRow>(
    `UPDATE recording_sessions
     SET status = $3,
         recording_started_at_ms = COALESCE($4, recording_started_at_ms),
         recording_stopped_at_ms = COALESCE($5, recording_stopped_at_ms),
         episode_id = COALESCE($6, episode_id),
         error = CASE WHEN $7::boolean THEN $8 ELSE error END,
         updated_at = now()
     WHERE session_id = $1 AND status = ANY($2::text[])
     RETURNING ${SESSION_COLUMNS}`,
    [
      sessionId,
      from,
      to,
      fields.recordingStartedAtMs ?? null,
      fields.recordingStoppedAtMs ?? null,
      fields.episodeId ?? null,
      fields.error !== undefined,
      fields.error ?? null,
    ],
  );
  return result.rows[0] ? toSession(result.rows[0]) : null;
}

export async function upsertTrackSummaries(
  db: Queryable,
  sessionId: string,
  tracks: TrackSummary[],
): Promise<void> {
  for (const track of tracks) {
    await db.query(
      `INSERT INTO recording_tracks
         (session_id, participant_id, kind, segment_count, chunk_count, total_bytes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (session_id, participant_id, kind)
       DO UPDATE SET segment_count = EXCLUDED.segment_count,
                     chunk_count = EXCLUDED.chunk_count,
                     total_bytes = EXCLUDED.total_bytes,
                     updated_at = now()`,
      [
        sessionId,
        track.participantId,
        track.kind,
        track.segmentCount,
        track.chunkCount,
        track.totalBytes,
      ],
    );
  }
}

export async function listTrackSummaries(
  db: Queryable,
  sessionId: string,
): Promise<(TrackSummary & { alignedObjectKey: string | null })[]> {
  const result = await db.query<{
    participant_id: string;
    kind: "local" | "backup";
    segment_count: number;
    chunk_count: number;
    total_bytes: string;
    aligned_object_key: string | null;
  }>(
    `SELECT participant_id, kind, segment_count, chunk_count, total_bytes, aligned_object_key
     FROM recording_tracks WHERE session_id = $1`,
    [sessionId],
  );
  return result.rows.map((row) => ({
    participantId: row.participant_id,
    kind: row.kind,
    segmentCount: row.segment_count,
    chunkCount: row.chunk_count,
    totalBytes: Number(row.total_bytes),
    alignedObjectKey: row.aligned_object_key,
  }));
}

// 期限を過ぎたセッションの状態を移す。
// - 収録を始めていない（waiting）ものは expired にする
// - 収録中（recording）のまま期限を過ぎたものは、録音が残っているので uploading（停止済み）にして、
//   ホストが後からエピソード化できるようにする（uploading はそのまま残す）
// cron は 1 日 1 回なので、読むときにも対象のセッションだけ移す（画面が古い状態で止まらないように）
async function settleExpiredSessions(
  db: Queryable,
  filter = "TRUE",
  params: unknown[] = [],
): Promise<{ expired: number; stopped: number }> {
  const result = await db.query<{ status: RecordingSessionStatus }>(
    `UPDATE recording_sessions
     SET status = CASE status WHEN 'waiting' THEN 'expired' ELSE 'uploading' END,
         updated_at = now()
     WHERE status IN ('waiting', 'recording') AND expires_at < now() AND ${filter}
     RETURNING status`,
    params,
  );
  const rows = result.rows ?? [];
  return {
    expired: rows.filter((row) => row.status === "expired").length,
    stopped: rows.filter((row) => row.status === "uploading").length,
  };
}

// 期限を過ぎたセッションと、ミックスが止まったもの（mixing のまま一定時間）を片付ける（cron）
export async function expireStaleRecordingSessions(
  db: Queryable,
  mixingTimeoutMinutes: number,
): Promise<{ expired: number; stopped: number; failed: number }> {
  const settled = await settleExpiredSessions(db);
  const failed = await db.query(
    `UPDATE recording_sessions
     SET status = 'failed',
         error = 'ミックス処理が時間内に終わりませんでした',
         updated_at = now()
     WHERE status = 'mixing' AND updated_at < now() - ($1 * interval '1 minute')`,
    [mixingTimeoutMinutes],
  );
  return { ...settled, failed: failed.rowCount ?? 0 };
}

// 収録一覧の札に使う、エピソードの処理状態
export async function listEpisodeStatuses(db: Queryable, episodeIds: number[]): Promise<Map<number, string>> {
  if (episodeIds.length === 0) return new Map();
  const result = await db.query<{ episode_id: number; status: string }>(
    "SELECT episode_id, status FROM episodes WHERE episode_id = ANY($1::int[])",
    [episodeIds],
  );
  return new Map(result.rows.map((row) => [Number(row.episode_id), row.status]));
}

export async function getEpisodeState(
  db: Queryable,
  episodeId: number,
): Promise<{ status: string; processingError: string | null } | null> {
  const result = await db.query<{ status: string; processing_error: string | null }>(
    "SELECT status, processing_error FROM episodes WHERE episode_id = $1",
    [episodeId],
  );
  const row = result.rows[0];
  return row ? { status: row.status, processingError: row.processing_error } : null;
}
