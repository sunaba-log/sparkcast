import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomConnection, type ConnectionStatus } from "@/lib/recording/room-connection";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];
  closed = false;
  private listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
    (this.listeners[type] ??= []).push(listener);
  }

  emit(type: string, event: { data?: unknown } = {}) {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }
}

const WELCOME = JSON.stringify({
  type: "welcome",
  self: { pid: "p", name: "n", role: "guest" },
  serverTime: 0,
  state: { status: "idle", startedAtMs: null, stoppedAtMs: null, maxParticipants: 6, participants: [] },
  chat: [],
});

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RoomConnection", () => {
  it("reconnects when nothing arrives for a while (a dead connection the OS has not noticed yet)", () => {
    const statuses: ConnectionStatus[] = [];
    const connection = new RoomConnection("https://realtime.example", "sid", "token", {
      onStatus: (status) => statuses.push(status),
    });
    connection.connect();
    const first = FakeWebSocket.instances[0];
    first.emit("open");
    first.emit("message", { data: WELCOME });
    expect(statuses.at(-1)).toBe("open");

    // pong が返ってこないまま 35 秒を超える
    vi.advanceTimersByTime(46_000);
    expect(statuses.at(-1)).toBe("reconnecting");
    expect(first.closed).toBe(true);

    vi.advanceTimersByTime(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    connection.close();
  });

  it("keeps the connection while pongs keep arriving", () => {
    const statuses: ConnectionStatus[] = [];
    const connection = new RoomConnection("https://realtime.example", "sid", "token", {
      onStatus: (status) => statuses.push(status),
    });
    connection.connect();
    const ws = FakeWebSocket.instances[0];
    ws.emit("open");
    ws.emit("message", { data: WELCOME });
    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(15_000);
      ws.emit("message", { data: JSON.stringify({ type: "pong", t0: 0, serverTime: 0 }) });
    }
    expect(statuses.at(-1)).toBe("open");
    expect(FakeWebSocket.instances).toHaveLength(1);
    connection.close();
  });
});
