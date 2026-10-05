// ブラウザ ⇄ Durable Object の WebSocket メッセージ（#166）。
// Worker 側の正本は apps/realtime/src/protocol.ts。変えるときは両方を揃える。

export type RecordingStatus = "idle" | "recording" | "stopped" | "closed";

export type MicState = "live" | "muted" | "ended" | "interrupted" | "unknown";

export type RecorderState = "idle" | "recording" | "error";

export type ParticipantView = {
  pid: string;
  name: string;
  role: "host" | "guest";
  connected: boolean;
  // SFU に push 済みの音声トラック（他の参加者が pull するのに使う）
  track: { sessionId: string; trackName: string } | null;
  mic: MicState;
  recorder: RecorderState;
  pendingChunks: number;
  uploadedChunks: number;
  uploadedBytes: number;
  // 収録停止後、手元の録音をすべて送り終えたか
  flushed: boolean;
  lastSeenMs: number;
};

export type RoomState = {
  status: RecordingStatus;
  startedAtMs: number | null;
  stoppedAtMs: number | null;
  maxParticipants: number;
  participants: ParticipantView[];
};

// 収録中のテキストチャット（ルームを閉じたら消す）
export type ChatMessage = { id: number; pid: string; name: string; text: string; at: number };

export const CHAT_MAX_LENGTH = 500;

export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "refresh"; token: string }
  | { type: "ping"; t0: number }
  | { type: "track"; sessionId: string; trackName: string }
  | { type: "chat"; text: string }
  | {
      type: "status";
      mic: MicState;
      recorder: RecorderState;
      pendingChunks: number;
      flushed: boolean;
    };

export type ServerMessage =
  | {
      type: "welcome";
      self: { pid: string; name: string; role: "host" | "guest" };
      serverTime: number;
      state: RoomState;
      // 入り直した人のための直近のチャット
      chat: ChatMessage[];
    }
  | { type: "state"; state: RoomState; serverTime: number }
  | { type: "pong"; t0: number; serverTime: number }
  | { type: "chat"; message: ChatMessage }
  | { type: "kicked" }
  | { type: "closed" }
  | { type: "error"; code: string; message: string };

// WebSocket の close コード（4000 番台はアプリ定義）
export const CLOSE_CODES = {
  unauthorized: 4001,
  replaced: 4002,
  kicked: 4003,
  closed: 4004,
  full: 4005,
  authTimeout: 4006,
} as const;
