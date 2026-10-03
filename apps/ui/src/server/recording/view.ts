import type { Pool } from "pg";
import type { RecordingSessionView } from "@/lib/recording/types";
import {
  getEpisodeState,
  listParticipants,
  listTrackSummaries,
  type RecordingSession,
} from "@/server/recording/repository";
import { getInvitePath } from "@/server/recording/service";

export async function buildSessionView(
  pool: Pick<Pool, "query">,
  roomSecret: string,
  session: RecordingSession,
): Promise<RecordingSessionView> {
  const [participants, tracks, episode, invitePath] = await Promise.all([
    listParticipants(pool, session.sessionId),
    listTrackSummaries(pool, session.sessionId),
    session.episodeId === null ? Promise.resolve(null) : getEpisodeState(pool, session.episodeId),
    getInvitePath({ roomSecret }, session.sessionId),
  ]);
  return {
    sessionId: session.sessionId,
    podcastId: session.podcastId,
    title: session.title,
    status: session.status,
    maxParticipants: session.maxParticipants,
    recordingStartedAtMs: session.recordingStartedAtMs,
    recordingStoppedAtMs: session.recordingStoppedAtMs,
    episodeId: session.episodeId,
    episodeStatus: episode?.status ?? null,
    episodeError: episode?.processingError ?? null,
    error: session.error,
    expiresAt: session.expiresAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
    invitePath,
    participants: participants.map((participant) => ({
      participantId: participant.participantId,
      displayName: participant.displayName,
      role: participant.role,
      removed: participant.removedAt !== null,
    })),
    tracks: tracks.map((track) => ({
      participantId: track.participantId,
      kind: track.kind,
      segmentCount: track.segmentCount,
      chunkCount: track.chunkCount,
      totalBytes: track.totalBytes,
      downloadable: track.alignedObjectKey !== null,
    })),
  };
}
