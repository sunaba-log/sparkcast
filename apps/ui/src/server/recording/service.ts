import type { Pool, PoolClient } from "pg";
import {
  createEpisodeRecord,
  setEpisodeAudioFilePath,
} from "@/server/episodes/repository";
import { buildRecordingSourceObjectPath } from "@/server/episodes/upload-contract";
import {
  createRecordingSession,
  createGuestParticipant,
  getParticipant,
  getRecordingSession,
  markParticipantRemoved,
  transitionSessionStatus,
  updateParticipantDisplayName,
  upsertHostParticipant,
  upsertTrackSummaries,
  type RecordingParticipant,
  type RecordingSession,
  type TrackSummary,
} from "@/server/recording/repository";
import {
  closeRoom,
  controlRoom,
  kickParticipant,
  snapshotManifest,
  type RecordingManifest,
} from "@/server/recording/realtime-client";
import {
  createInviteKey,
  createRejoinKey,
  signRoomToken,
  verifyInviteKey,
  verifyRejoinKey,
} from "@/server/recording/tokens";
import type { MixerJobInput } from "@/server/recording/jobs";

// 収録ルームのユースケース（#166）。ルートハンドラは認証と入力検証だけを行い、
// ここに依存（DB・Worker・Job 起動）を渡して呼ぶ。

export const ROOM_TOKEN_TTL_SECONDS = 2 * 60 * 60;

export type RecordingDeps = {
  pool: Pick<Pool, "query" | "connect">;
  roomSecret: string;
  serviceSecret: string;
  realtimeBaseUrl: string;
  mixerJobName: string;
  maxParticipants: number;
  roomTtlHours: number;
  runMixerJob: (jobName: string, input: MixerJobInput) => Promise<unknown>;
  fetchImpl?: typeof fetch;
};

export class RecordingError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "INVALID_INVITE"
      | "CLOSED"
      | "CONSENT_REQUIRED"
      | "REMOVED"
      | "PARTICIPANT_LIMIT"
      | "INVALID_STATE",
    message: string,
  ) {
    super(message);
  }
}

export type JoinResult = {
  sessionId: string;
  participantId: string;
  role: "host" | "guest";
  displayName: string;
  token: string;
  tokenExpiresAt: number;
  realtimeBaseUrl: string;
  rejoinKey: string;
};

function realtimeConfig(deps: RecordingDeps) {
  return {
    baseUrl: deps.realtimeBaseUrl,
    serviceSecret: deps.serviceSecret,
    fetchImpl: deps.fetchImpl,
  };
}

export function buildInvitePath(sessionId: string, inviteKey: string): string {
  return `/join/${sessionId}?k=${encodeURIComponent(inviteKey)}`;
}

export async function createSession(
  deps: RecordingDeps,
  input: { podcastId: number; hostUserId: string; title: string | null },
): Promise<{ session: RecordingSession; invitePath: string }> {
  const session = await createRecordingSession(deps.pool, {
    podcastId: input.podcastId,
    hostUserId: input.hostUserId,
    title: input.title,
    maxParticipants: deps.maxParticipants,
    ttlHours: deps.roomTtlHours,
  });
  const inviteKey = await createInviteKey(session.sessionId, deps.roomSecret);
  return { session, invitePath: buildInvitePath(session.sessionId, inviteKey) };
}

export async function getInvitePath(
  deps: Pick<RecordingDeps, "roomSecret">,
  sessionId: string,
): Promise<string> {
  return buildInvitePath(sessionId, await createInviteKey(sessionId, deps.roomSecret));
}

function isJoinable(session: RecordingSession, now = Date.now()): boolean {
  if (session.expiresAt.getTime() <= now) return false;
  // 収録停止後（uploading）も、未送信の録音を送り直すために入り直せるようにする
  return ["waiting", "recording", "uploading"].includes(session.status);
}

async function issueToken(
  deps: RecordingDeps,
  session: RecordingSession,
  participant: RecordingParticipant,
): Promise<JoinResult> {
  const { token, expiresAt } = await signRoomToken(
    {
      sid: session.sessionId,
      pid: participant.participantId,
      role: participant.role,
      name: participant.displayName,
      maxp: session.maxParticipants,
      rexp: Math.floor(session.expiresAt.getTime() / 1000),
    },
    deps.roomSecret,
    ROOM_TOKEN_TTL_SECONDS,
  );
  return {
    sessionId: session.sessionId,
    participantId: participant.participantId,
    role: participant.role,
    displayName: participant.displayName,
    token,
    tokenExpiresAt: expiresAt,
    realtimeBaseUrl: deps.realtimeBaseUrl,
    rejoinKey: await createRejoinKey(participant.participantId, deps.roomSecret),
  };
}

// ホストの入室。呼び出し側でポッドキャストへの権限を確認済みであること。
export async function joinAsHost(
  deps: RecordingDeps,
  input: { session: RecordingSession; userId: string; displayName: string },
): Promise<JoinResult> {
  if (!isJoinable(input.session)) {
    throw new RecordingError("CLOSED", "この収録ルームは終了しています");
  }
  const participant = await upsertHostParticipant(deps.pool, {
    sessionId: input.session.sessionId,
    userId: input.userId,
    displayName: input.displayName,
  });
  return issueToken(deps, input.session, participant);
}

export async function joinAsGuest(
  deps: RecordingDeps,
  input: {
    sessionId: string;
    inviteKey: string;
    displayName: string;
    consent: boolean;
    participantId?: string;
    rejoinKey?: string;
  },
): Promise<JoinResult> {
  const session = await getRecordingSession(deps.pool, input.sessionId);
  if (!session || !(await verifyInviteKey(input.sessionId, input.inviteKey, deps.roomSecret))) {
    throw new RecordingError("INVALID_INVITE", "招待 URL が正しくありません");
  }
  if (!isJoinable(session)) {
    throw new RecordingError("CLOSED", "この収録ルームは終了しています");
  }
  if (!input.consent) {
    throw new RecordingError("CONSENT_REQUIRED", "録音への同意が必要です");
  }

  // 同じ端末からの入り直し（リロード・回線断）は同じ参加者として扱う
  if (input.participantId && input.rejoinKey) {
    const existing = await getParticipant(deps.pool, input.participantId);
    if (
      existing &&
      existing.sessionId === session.sessionId &&
      existing.role === "guest" &&
      (await verifyRejoinKey(existing.participantId, input.rejoinKey, deps.roomSecret))
    ) {
      if (existing.removedAt) {
        throw new RecordingError("REMOVED", "ホストによって退出させられました");
      }
      if (existing.displayName !== input.displayName) {
        await updateParticipantDisplayName(deps.pool, existing.participantId, input.displayName);
        existing.displayName = input.displayName;
      }
      return issueToken(deps, session, existing);
    }
  }

  if (session.status === "uploading") {
    throw new RecordingError("CLOSED", "収録はすでに終了しています");
  }

  const client = (await deps.pool.connect()) as PoolClient;
  try {
    const participant = await createGuestParticipant(client, {
      sessionId: session.sessionId,
      displayName: input.displayName,
    });
    return issueToken(deps, session, participant);
  } catch (error) {
    if (error instanceof Error && error.message === "PARTICIPANT_LIMIT") {
      throw new RecordingError("PARTICIPANT_LIMIT", "このルームの参加者数の上限に達しました");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function controlRecording(
  deps: RecordingDeps,
  session: RecordingSession,
  action: "start" | "stop",
): Promise<RecordingSession> {
  if (action === "start") {
    if (session.status === "recording") return session;
    if (session.status !== "waiting") {
      throw new RecordingError("INVALID_STATE", "このルームでは収録を開始できません");
    }
    const result = await controlRoom(realtimeConfig(deps), session.sessionId, "start");
    const updated = await transitionSessionStatus(deps.pool, session.sessionId, ["waiting"], "recording", {
      recordingStartedAtMs: result.startedAtMs ?? undefined,
    });
    return updated ?? session;
  }

  if (session.status === "uploading") return session;
  if (session.status !== "recording") {
    throw new RecordingError("INVALID_STATE", "収録中ではありません");
  }
  const result = await controlRoom(realtimeConfig(deps), session.sessionId, "stop");
  const updated = await transitionSessionStatus(deps.pool, session.sessionId, ["recording"], "uploading", {
    recordingStoppedAtMs: result.stoppedAtMs ?? undefined,
  });
  return updated ?? session;
}

export async function removeParticipant(
  deps: RecordingDeps,
  session: RecordingSession,
  participantId: string,
): Promise<void> {
  const removed = await markParticipantRemoved(deps.pool, session.sessionId, participantId);
  if (!removed) {
    throw new RecordingError("NOT_FOUND", "参加者が見つかりません");
  }
  await kickParticipant(realtimeConfig(deps), session.sessionId, participantId);
}

export function summarizeManifest(manifest: RecordingManifest): TrackSummary[] {
  const summaries = new Map<string, TrackSummary & { segments: Set<string> }>();
  for (const chunk of manifest.chunks) {
    const key = `${chunk.participantId}:${chunk.kind}`;
    const summary =
      summaries.get(key) ??
      {
        participantId: chunk.participantId,
        kind: chunk.kind,
        segmentCount: 0,
        chunkCount: 0,
        totalBytes: 0,
        segments: new Set<string>(),
      };
    summary.segments.add(chunk.segment);
    summary.segmentCount = summary.segments.size;
    summary.chunkCount += 1;
    summary.totalBytes += chunk.bytes;
    summaries.set(key, summary);
  }
  return [...summaries.values()].map((summary) => ({
    participantId: summary.participantId,
    kind: summary.kind,
    segmentCount: summary.segmentCount,
    chunkCount: summary.chunkCount,
    totalBytes: summary.totalBytes,
  }));
}

export function buildEpisodeTitle(session: RecordingSession, now = new Date()): string {
  if (session.title?.trim()) return session.title.trim();
  const date = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `収録 ${date}`;
}

// 前回のエピソード化が起動前に失敗していたら、そのエピソード行を使い回す
async function reuseFailedEpisode(
  deps: RecordingDeps,
  session: RecordingSession,
): Promise<number | null> {
  if (session.episodeId === null) return null;
  const result = await deps.pool.query(
    `UPDATE episodes
     SET status = 'upload_pending', processing_error = NULL, updated_at = now()
     WHERE episode_id = $1 AND status IN ('upload_pending', 'failed')`,
    [session.episodeId],
  );
  return result.rowCount === 1 ? session.episodeId : null;
}

// 収録を確定し、エピソードを作って mixer を起動する。
// uploading → mixing の条件付き UPDATE で二重起動を防ぐ。
export async function finalizeRecording(
  deps: RecordingDeps,
  session: RecordingSession,
): Promise<{ episodeId: number; objectPath: string }> {
  const locked = await transitionSessionStatus(deps.pool, session.sessionId, ["uploading"], "mixing", {
    error: null,
  });
  if (!locked) {
    throw new RecordingError("INVALID_STATE", "このルームはエピソード化できる状態ではありません");
  }

  let episodeId: number | null = null;
  try {
    const manifest = await snapshotManifest(realtimeConfig(deps), session.sessionId);
    if (manifest.chunks.length === 0) {
      throw new RecordingError("INVALID_STATE", "録音データが 1 件も届いていません");
    }
    await upsertTrackSummaries(deps.pool, session.sessionId, summarizeManifest(manifest));

    const reused = await reuseFailedEpisode(deps, locked);
    let objectPath: string;
    if (reused !== null) {
      episodeId = reused;
      objectPath = buildRecordingSourceObjectPath(session.podcastId, episodeId, session.sessionId);
    } else {
      const client = (await deps.pool.connect()) as PoolClient;
      try {
        await client.query("BEGIN");
        episodeId = await createEpisodeRecord(client, {
          podcastId: session.podcastId,
          title: buildEpisodeTitle(session),
          fileName: "recording.flac",
        });
        objectPath = buildRecordingSourceObjectPath(session.podcastId, episodeId, session.sessionId);
        await setEpisodeAudioFilePath(client, episodeId, objectPath);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        episodeId = null;
        throw error;
      } finally {
        client.release();
      }
    }

    await transitionSessionStatus(deps.pool, session.sessionId, ["mixing"], "mixing", {
      episodeId,
    });
    await deps.runMixerJob(deps.mixerJobName, {
      sessionId: session.sessionId,
      podcastId: session.podcastId,
      episodeId,
      objectPath,
    });
    // 通話は終わっているので、ルームを閉じて在室中の端末を切断する
    await closeRoom(realtimeConfig(deps), session.sessionId).catch((error) => {
      console.warn("Failed to close realtime room", error);
    });
    return { episodeId, objectPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 起動に失敗したら uploading に戻し、ホストがやり直せるようにする
    await transitionSessionStatus(deps.pool, session.sessionId, ["mixing"], "uploading", {
      error: message.slice(0, 2000),
    });
    if (episodeId !== null) {
      await deps.pool.query(
        `UPDATE episodes
         SET status = 'failed', processing_error = $2, updated_at = now()
         WHERE episode_id = $1 AND status = 'upload_pending'`,
        [episodeId, `収録のミックス開始に失敗しました: ${message}`.slice(0, 2000)],
      );
    }
    throw error;
  }
}
