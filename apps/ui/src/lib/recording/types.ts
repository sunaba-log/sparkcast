// 収録ルーム（#166）の API とブラウザで共有する型。サーバー専用の依存を持たないこと。

export type RecordingSessionStatus =
  | "waiting"
  | "recording"
  | "uploading"
  | "mixing"
  | "done"
  | "failed"
  | "expired";

export type ParticipantRole = "host" | "guest";

export type JoinResponse = {
  sessionId: string;
  participantId: string;
  role: ParticipantRole;
  displayName: string;
  token: string;
  tokenExpiresAt: number;
  realtimeBaseUrl: string;
  rejoinKey: string;
};

export type RecordingSessionView = {
  sessionId: string;
  podcastId: number;
  title: string | null;
  status: RecordingSessionStatus;
  maxParticipants: number;
  recordingStartedAtMs: number | null;
  recordingStoppedAtMs: number | null;
  episodeId: number | null;
  episodeStatus: string | null;
  episodeError: string | null;
  error: string | null;
  expiresAt: string;
  createdAt: string;
  // 入室の締め切り（新しいゲストを入れない）
  entryLocked: boolean;
  invitePath: string;
  participants: {
    participantId: string;
    displayName: string;
    role: ParticipantRole;
    removed: boolean;
  }[];
  tracks: {
    participantId: string;
    kind: "local" | "backup";
    segmentCount: number;
    chunkCount: number;
    totalBytes: number;
    downloadable: boolean;
  }[];
};

export const RECORDING_STATUS_LABELS: Record<RecordingSessionStatus, string> = {
  waiting: "待機中",
  recording: "収録中",
  uploading: "アップロード待ち",
  mixing: "ミックス中",
  done: "エピソード化済み",
  failed: "失敗",
  expired: "期限切れ",
};

// 札に出す状態。ミックスまで済んでも、その後の文字起こしなどでエピソードが失敗したら「失敗」と出す
export function recordingDisplayStatus(
  status: RecordingSessionStatus,
  episodeStatus: string | null | undefined,
): RecordingSessionStatus {
  return status === "done" && episodeStatus === "failed" ? "failed" : status;
}
