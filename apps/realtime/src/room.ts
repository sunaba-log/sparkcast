import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import {
  CLOSE_CODES,
  type ClientMessage,
  type MicState,
  type ParticipantView,
  type RecorderState,
  type RecordingStatus,
  type RoomState,
  type ServerMessage,
} from "./protocol";
import { verifyRoomToken } from "./tokens";

// 収録ルーム 1 つ = Durable Object 1 つ（名前はセッション ID）。
// 在室・SFU トラックの配布・収録の開始/停止・時刻同期・録音チャンクの台帳を持つ。
// WebSocket は Hibernation API で受け、待機中は課金されないようにする。

export type ChunkRecord = {
  kind: "local" | "backup";
  participantId: string;
  uploaderId: string;
  segment: string;
  seq: number;
  segmentStartMs: number;
  chunkStartMs: number;
  durationMs: number | null;
  bytes: number;
  sha256: string;
  mime: string;
  sampleRate: number | null;
  key: string;
  uploadedAtMs: number;
};

export type Manifest = {
  sessionId: string;
  recording: { startedAtMs: number | null; stoppedAtMs: number | null };
  participants: { participantId: string; name: string; role: "host" | "guest" }[];
  chunks: ChunkRecord[];
};

type Attachment = { pid: string; role: "host" | "guest"; name: string; exp: number } | null;

// 1 人の端末から受け付ける録音の総量（3 時間×WAV フォールバックでも収まる上限）
export const MAX_BYTES_PER_UPLOADER = 2 * 1024 * 1024 * 1024;

type ParticipantRow = {
  pid: string;
  name: string;
  role: "host" | "guest";
  sfu_session_id: string | null;
  track_name: string | null;
  connected: number;
  mic: MicState;
  recorder: RecorderState;
  pending_chunks: number;
  flushed: number;
  kicked: number;
  last_seen_ms: number;
};

export class Room extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
    });
  }

  private migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS participants (
        pid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        sfu_session_id TEXT,
        track_name TEXT,
        connected INTEGER NOT NULL DEFAULT 0,
        mic TEXT NOT NULL DEFAULT 'unknown',
        recorder TEXT NOT NULL DEFAULT 'idle',
        pending_chunks INTEGER NOT NULL DEFAULT 0,
        flushed INTEGER NOT NULL DEFAULT 0,
        kicked INTEGER NOT NULL DEFAULT 0,
        last_seen_ms INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sfu_sessions (
        sfu_session_id TEXT PRIMARY KEY,
        pid TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chunks (
        key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        uploader_id TEXT NOT NULL,
        segment TEXT NOT NULL,
        seq INTEGER NOT NULL,
        segment_start_ms INTEGER NOT NULL,
        chunk_start_ms INTEGER NOT NULL,
        duration_ms INTEGER,
        bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        mime TEXT NOT NULL,
        sample_rate INTEGER,
        uploaded_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_uploader ON chunks (uploader_id);
    `);
  }

  // ---- meta ----

  private getMeta(key: string): string | null {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0];
    return row ? row.value : null;
  }

  private setMeta(key: string, value: string | number) {
    this.sql.exec(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      key,
      String(value),
    );
  }

  private get status(): RecordingStatus {
    return (this.getMeta("status") as RecordingStatus | null) ?? "idle";
  }

  private numberMeta(key: string): number | null {
    const value = this.getMeta(key);
    return value === null ? null : Number(value);
  }

  // ---- state ----

  private participants(): ParticipantRow[] {
    return this.sql.exec<ParticipantRow>("SELECT * FROM participants ORDER BY rowid").toArray();
  }

  private uploadTotals(): Map<string, { chunks: number; bytes: number }> {
    const rows = this.sql
      .exec<{ uploader_id: string; chunks: number; bytes: number }>(
        "SELECT uploader_id, COUNT(*) AS chunks, SUM(bytes) AS bytes FROM chunks GROUP BY uploader_id",
      )
      .toArray();
    return new Map(rows.map((row) => [row.uploader_id, { chunks: row.chunks, bytes: row.bytes }]));
  }

  roomState(): RoomState {
    const totals = this.uploadTotals();
    const participants: ParticipantView[] = this.participants()
      .filter((row) => !row.kicked)
      .map((row) => ({
        pid: row.pid,
        name: row.name,
        role: row.role,
        connected: row.connected === 1,
        track:
          row.connected === 1 && row.sfu_session_id && row.track_name
            ? { sessionId: row.sfu_session_id, trackName: row.track_name }
            : null,
        mic: row.mic,
        recorder: row.recorder,
        pendingChunks: row.pending_chunks,
        uploadedChunks: totals.get(row.pid)?.chunks ?? 0,
        uploadedBytes: totals.get(row.pid)?.bytes ?? 0,
        flushed: row.flushed === 1,
        lastSeenMs: row.last_seen_ms,
      }));
    return {
      status: this.status,
      startedAtMs: this.numberMeta("startedAtMs"),
      stoppedAtMs: this.numberMeta("stoppedAtMs"),
      maxParticipants: this.numberMeta("maxParticipants") ?? 6,
      participants,
    };
  }

  private send(ws: WebSocket, message: ServerMessage) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // 切断済みのソケットは無視する
    }
  }

  private broadcast() {
    const message: ServerMessage = { type: "state", state: this.roomState(), serverTime: Date.now() };
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment;
      if (!attachment) continue;
      try {
        ws.send(payload);
      } catch {
        // 無視
      }
    }
  }

  private socketsFor(pid: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() as Attachment)?.pid === pid);
  }

  // ---- WebSocket ----

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const roomId = request.headers.get("X-Room-Id");
    if (!roomId) return new Response("Missing room id", { status: 400 });
    if (!this.getMeta("roomId")) this.setMeta("roomId", roomId);
    if (this.status === "closed") return new Response("Room closed", { status: 410 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(null);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > 16_384) return;
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    const attachment = ws.deserializeAttachment() as Attachment;

    if (!attachment) {
      if (message.type !== "auth") {
        ws.close(CLOSE_CODES.unauthorized, "auth required");
        return;
      }
      await this.authenticate(ws, message.token);
      return;
    }

    if (attachment.exp * 1000 <= Date.now() && message.type !== "refresh") {
      ws.close(CLOSE_CODES.unauthorized, "token expired");
      return;
    }

    switch (message.type) {
      case "ping":
        this.send(ws, { type: "pong", t0: Number(message.t0), serverTime: Date.now() });
        return;
      case "refresh": {
        const claims = await verifyRoomToken(message.token, this.env.ROOM_SECRET);
        if (!claims || claims.pid !== attachment.pid || claims.sid !== this.getMeta("roomId")) {
          ws.close(CLOSE_CODES.unauthorized, "invalid token");
          return;
        }
        ws.serializeAttachment({ ...attachment, exp: claims.exp, name: claims.name });
        this.sql.exec("UPDATE participants SET name = ? WHERE pid = ?", claims.name, attachment.pid);
        return;
      }
      case "track": {
        if (!this.ownsSfuSession(attachment.pid, String(message.sessionId))) return;
        this.sql.exec(
          "UPDATE participants SET sfu_session_id = ?, track_name = ?, last_seen_ms = ? WHERE pid = ?",
          String(message.sessionId),
          String(message.trackName).slice(0, 128),
          Date.now(),
          attachment.pid,
        );
        this.broadcast();
        return;
      }
      case "status": {
        const mic = ["live", "muted", "ended", "interrupted", "unknown"].includes(message.mic)
          ? message.mic
          : "unknown";
        const recorder = ["idle", "recording", "error"].includes(message.recorder) ? message.recorder : "idle";
        const pending = Math.max(0, Math.min(100_000, Math.floor(Number(message.pendingChunks) || 0)));
        const before = this.sql
          .exec<ParticipantRow>("SELECT * FROM participants WHERE pid = ?", attachment.pid)
          .toArray()[0];
        this.sql.exec(
          "UPDATE participants SET mic = ?, recorder = ?, pending_chunks = ?, flushed = ?, last_seen_ms = ? WHERE pid = ?",
          mic,
          recorder,
          pending,
          message.flushed ? 1 : 0,
          Date.now(),
          attachment.pid,
        );
        // 何も変わらない定期報告では全員への配信を省く
        if (
          !before ||
          before.mic !== mic ||
          before.recorder !== recorder ||
          before.pending_chunks !== pending ||
          before.flushed !== (message.flushed ? 1 : 0)
        ) {
          this.broadcast();
        }
        return;
      }
      default:
        return;
    }
  }

  private async authenticate(ws: WebSocket, token: string) {
    const claims = await verifyRoomToken(String(token), this.env.ROOM_SECRET);
    const roomId = this.getMeta("roomId");
    if (!claims || claims.sid !== roomId) {
      this.send(ws, { type: "error", code: "unauthorized", message: "認証に失敗しました" });
      ws.close(CLOSE_CODES.unauthorized, "unauthorized");
      return;
    }
    if (this.status === "closed" || claims.rexp * 1000 <= Date.now()) {
      this.send(ws, { type: "closed" });
      ws.close(CLOSE_CODES.closed, "closed");
      return;
    }
    const existing = this.sql.exec<ParticipantRow>("SELECT * FROM participants WHERE pid = ?", claims.pid).toArray()[0];
    if (existing?.kicked) {
      this.send(ws, { type: "kicked" });
      ws.close(CLOSE_CODES.kicked, "kicked");
      return;
    }

    // 定員は「同時に接続している人数」で数える（本人の入り直しは数えない）
    this.setMeta("maxParticipants", claims.maxp);
    const connectedOthers = this.participants().filter(
      (row) => row.connected === 1 && !row.kicked && row.pid !== claims.pid,
    ).length;
    if (connectedOthers >= claims.maxp) {
      this.send(ws, { type: "error", code: "full", message: "ルームが満員です" });
      ws.close(CLOSE_CODES.full, "full");
      return;
    }

    // 同じ参加者の古い接続（リロード前のタブなど）は閉じる
    for (const other of this.socketsFor(claims.pid)) {
      if (other !== ws) other.close(CLOSE_CODES.replaced, "replaced");
    }

    ws.serializeAttachment({ pid: claims.pid, role: claims.role, name: claims.name, exp: claims.exp });
    this.sql.exec(
      `INSERT INTO participants (pid, name, role, connected, last_seen_ms)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT (pid) DO UPDATE SET name = excluded.name, connected = 1, last_seen_ms = excluded.last_seen_ms`,
      claims.pid,
      claims.name,
      claims.role,
      Date.now(),
    );

    // ルームの期限で自動的に閉じる
    const roomExpiresAt = claims.rexp * 1000;
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || currentAlarm > roomExpiresAt) {
      await this.ctx.storage.setAlarm(roomExpiresAt);
    }

    this.send(ws, {
      type: "welcome",
      self: { pid: claims.pid, name: claims.name, role: claims.role },
      serverTime: Date.now(),
      state: this.roomState(),
    });
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket) {
    this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.handleDisconnect(ws);
  }

  private handleDisconnect(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as Attachment;
    if (!attachment) return;
    const stillConnected = this.socketsFor(attachment.pid).some(
      (other) => other !== ws && other.readyState === WebSocket.OPEN,
    );
    if (!stillConnected) {
      this.sql.exec(
        "UPDATE participants SET connected = 0, last_seen_ms = ? WHERE pid = ?",
        Date.now(),
        attachment.pid,
      );
      this.broadcast();
    }
  }

  async alarm() {
    await this.close();
  }

  // ---- RPC（Worker から呼ぶ） ----

  registerSfuSession(pid: string, sfuSessionId: string) {
    this.sql.exec(
      "INSERT INTO sfu_sessions (sfu_session_id, pid) VALUES (?, ?) ON CONFLICT (sfu_session_id) DO NOTHING",
      sfuSessionId,
      pid,
    );
  }

  ownsSfuSession(pid: string, sfuSessionId: string): boolean {
    const row = this.sql
      .exec<{ pid: string }>("SELECT pid FROM sfu_sessions WHERE sfu_session_id = ?", sfuSessionId)
      .toArray()[0];
    return row?.pid === pid;
  }

  // pull しようとしている相手のセッションが、すべてこのルームの参加者のものか
  sfuSessionsInRoom(sfuSessionIds: string[]): boolean {
    return sfuSessionIds.every(
      (id) =>
        this.sql.exec("SELECT 1 FROM sfu_sessions WHERE sfu_session_id = ?", id).toArray().length === 1,
    );
  }

  // room JWT で本人確認は済んでいるので、ここでは「閉じていない・退出させられていない」だけを見る。
  // WebSocket の認証より先に SFU やチャンク送信（リロード後の再送など）が届くことがあるため、
  // まだ参加者の行が無くても拒否しない。
  isActiveParticipant(pid: string): boolean {
    if (this.status === "closed") return false;
    const row = this.sql.exec<ParticipantRow>("SELECT * FROM participants WHERE pid = ?", pid).toArray()[0];
    return !row?.kicked;
  }

  recordChunk(chunk: ChunkRecord): { ok: true } | { ok: false; reason: string } {
    const status = this.status;
    if (status !== "recording" && status !== "stopped") {
      return { ok: false, reason: `room is ${status}` };
    }
    if (!this.isActiveParticipant(chunk.uploaderId)) {
      return { ok: false, reason: "not a participant" };
    }
    const used = this.sql
      .exec<{ bytes: number | null }>(
        "SELECT SUM(bytes) AS bytes FROM chunks WHERE uploader_id = ? AND key != ?",
        chunk.uploaderId,
        chunk.key,
      )
      .toArray()[0]?.bytes ?? 0;
    if (used + chunk.bytes > MAX_BYTES_PER_UPLOADER) {
      return { ok: false, reason: "upload quota exceeded" };
    }
    this.sql.exec(
      `INSERT INTO chunks (key, kind, participant_id, uploader_id, segment, seq, segment_start_ms,
         chunk_start_ms, duration_ms, bytes, sha256, mime, sample_rate, uploaded_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET bytes = excluded.bytes, sha256 = excluded.sha256,
         duration_ms = excluded.duration_ms, uploaded_at_ms = excluded.uploaded_at_ms`,
      chunk.key,
      chunk.kind,
      chunk.participantId,
      chunk.uploaderId,
      chunk.segment,
      chunk.seq,
      chunk.segmentStartMs,
      chunk.chunkStartMs,
      chunk.durationMs,
      chunk.bytes,
      chunk.sha256,
      chunk.mime,
      chunk.sampleRate,
      chunk.uploadedAtMs,
    );
    this.broadcast();
    return { ok: true };
  }

  control(action: "start" | "stop") {
    const now = Date.now();
    const status = this.status;
    if (action === "start" && status === "idle") {
      this.setMeta("status", "recording");
      this.setMeta("startedAtMs", now);
      this.broadcast();
    } else if (action === "stop" && status === "recording") {
      this.setMeta("status", "stopped");
      this.setMeta("stoppedAtMs", now);
      this.sql.exec("UPDATE participants SET flushed = 0");
      this.broadcast();
    }
    return {
      status: this.status,
      startedAtMs: this.numberMeta("startedAtMs"),
      stoppedAtMs: this.numberMeta("stoppedAtMs"),
    };
  }

  kick(pid: string) {
    // まだ一度も接続していない参加者でも、発行済みのトークンで入れないように行を作っておく
    this.sql.exec(
      `INSERT INTO participants (pid, name, role, kicked) VALUES (?, '', 'guest', 1)
       ON CONFLICT (pid) DO UPDATE SET kicked = 1, connected = 0`,
      pid,
    );
    for (const ws of this.socketsFor(pid)) {
      this.send(ws, { type: "kicked" });
      ws.close(CLOSE_CODES.kicked, "kicked");
    }
    this.broadcast();
  }

  async close() {
    this.setMeta("status", "closed");
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { type: "closed" });
      try {
        ws.close(CLOSE_CODES.closed, "closed");
      } catch {
        // 無視
      }
    }
    this.sql.exec("UPDATE participants SET connected = 0");
    await this.ctx.storage.deleteAlarm();
  }

  manifest(): Manifest {
    const chunks = this.sql
      .exec<{
        key: string;
        kind: "local" | "backup";
        participant_id: string;
        uploader_id: string;
        segment: string;
        seq: number;
        segment_start_ms: number;
        chunk_start_ms: number;
        duration_ms: number | null;
        bytes: number;
        sha256: string;
        mime: string;
        sample_rate: number | null;
        uploaded_at_ms: number;
      }>("SELECT * FROM chunks ORDER BY participant_id, kind, segment, seq")
      .toArray()
      .map((row) => ({
        kind: row.kind,
        participantId: row.participant_id,
        uploaderId: row.uploader_id,
        segment: row.segment,
        seq: row.seq,
        segmentStartMs: row.segment_start_ms,
        chunkStartMs: row.chunk_start_ms,
        durationMs: row.duration_ms,
        bytes: row.bytes,
        sha256: row.sha256,
        mime: row.mime,
        sampleRate: row.sample_rate,
        key: row.key,
        uploadedAtMs: row.uploaded_at_ms,
      }));
    return {
      sessionId: this.getMeta("roomId") ?? "",
      recording: {
        startedAtMs: this.numberMeta("startedAtMs"),
        stoppedAtMs: this.numberMeta("stoppedAtMs"),
      },
      participants: this.participants().map((row) => ({
        participantId: row.pid,
        name: row.name,
        role: row.role,
      })),
      chunks,
    };
  }

  // テストとサービス API 用
  setRoomId(roomId: string) {
    if (!this.getMeta("roomId")) this.setMeta("roomId", roomId);
  }
}
