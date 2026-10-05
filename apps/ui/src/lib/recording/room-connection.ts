import { ClockSync, localNow } from "@/lib/recording/clock";
import {
  CLOSE_CODES,
  type ChatMessage,
  type ClientMessage,
  type RoomState,
  type ServerMessage,
} from "@/lib/recording/protocol";

// Durable Object との WebSocket（#166）。切れたら入り直し、ping で時刻を合わせ続ける。

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "ended";

export type EndReason = "kicked" | "closed" | "replaced" | "unauthorized" | "full";

type Listener = {
  onState?: (state: RoomState) => void;
  onStatus?: (status: ConnectionStatus) => void;
  onEnded?: (reason: EndReason) => void;
  onWelcome?: (self: { pid: string; name: string; role: "host" | "guest" }) => void;
  // 入室時は直近の履歴（history）、そのあとは 1 件ずつ
  onChat?: (messages: ChatMessage[], history: boolean) => void;
  onChatError?: (message: string) => void;
};

const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000];
const PING_INTERVAL_MS = 15_000;
const PING_BURST = 5;

export class RoomConnection {
  readonly clock = new ClockSync();
  private ws: WebSocket | null = null;
  private attempts = 0;
  private stopped = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private status: ConnectionStatus = "connecting";

  constructor(
    private readonly baseUrl: string,
    private readonly sessionId: string,
    private token: string,
    private readonly listener: Listener,
  ) {}

  connect() {
    this.stopped = false;
    this.open();
  }

  updateToken(token: string) {
    this.token = token;
    this.send({ type: "refresh", token });
  }

  send(message: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  get isOpen(): boolean {
    return this.status === "open";
  }

  close() {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close(1000, "leave");
    this.ws = null;
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.listener.onStatus?.(status);
  }

  private open() {
    const url = `${this.baseUrl.replace(/^http/, "ws")}/rooms/${this.sessionId}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "auth", token: this.token } satisfies ClientMessage));
    });
    ws.addEventListener("message", (event) => this.handleMessage(event.data));
    ws.addEventListener("close", (event) => this.handleClose(ws, event.code));
  }

  private handleMessage(data: unknown) {
    if (typeof data !== "string") return;
    let message: ServerMessage;
    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    switch (message.type) {
      case "welcome":
        this.attempts = 0;
        this.setStatus("open");
        this.listener.onWelcome?.(message.self);
        this.listener.onState?.(message.state);
        this.listener.onChat?.(message.chat ?? [], true);
        this.startPinging();
        return;
      case "state":
        this.listener.onState?.(message.state);
        return;
      case "chat":
        this.listener.onChat?.([message.message], false);
        return;
      case "error":
        if (message.code.startsWith("chat_")) this.listener.onChatError?.(message.message);
        return;
      case "pong":
        this.clock.addSample({ t0: message.t0, t1: localNow(), serverTime: message.serverTime });
        return;
      case "kicked":
        this.end("kicked");
        return;
      case "closed":
        this.end("closed");
        return;
      default:
        return;
    }
  }

  private handleClose(ws: WebSocket, code: number) {
    if (ws !== this.ws) return;
    this.clearTimers();
    if (this.stopped) return;
    const reasons: Partial<Record<number, EndReason>> = {
      [CLOSE_CODES.kicked]: "kicked",
      [CLOSE_CODES.closed]: "closed",
      [CLOSE_CODES.replaced]: "replaced",
      [CLOSE_CODES.full]: "full",
    };
    const reason = reasons[code];
    if (reason) {
      this.end(reason);
      return;
    }
    // 認証エラーは期限切れの可能性がある。呼び出し側がトークンを更新するまで再試行を続ける
    this.setStatus("reconnecting");
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempts, RECONNECT_DELAYS_MS.length - 1)];
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private end(reason: EndReason) {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimers();
    this.setStatus("ended");
    this.listener.onEnded?.(reason);
    this.ws?.close(1000, reason);
  }

  private startPinging() {
    this.clearTimers();
    const burst = () => {
      for (let i = 0; i < PING_BURST; i += 1) {
        setTimeout(() => this.send({ type: "ping", t0: localNow() }), i * 150);
      }
    };
    burst();
    this.pingTimer = setInterval(burst, PING_INTERVAL_MS);
  }

  private clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
  }
}
