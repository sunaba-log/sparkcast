import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { GUEST, GUEST2, HOST, room, roomToken, serviceToken } from "./helpers";

const BASE = "https://realtime.test";

type Message = Record<string, any>;

class Client {
  messages: Message[] = [];
  closed: { code: number } | null = null;
  private waiters: { predicate: (message: Message) => boolean; resolve: (message: Message) => void }[] = [];

  constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Message;
      this.messages.push(message);
      this.waiters = this.waiters.filter((waiter) => {
        if (!waiter.predicate(message)) return true;
        waiter.resolve(message);
        return false;
      });
    });
    ws.addEventListener("close", (event) => {
      this.closed = { code: event.code };
    });
    ws.accept();
  }

  send(message: Message) {
    this.ws.send(JSON.stringify(message));
  }

  next(predicate: (message: Message) => boolean, timeoutMs = 2000): Promise<Message> {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      this.waiters.push({ predicate, resolve });
      setTimeout(() => reject(new Error("timed out")), timeoutMs);
    });
  }

  async waitClosed(timeoutMs = 2000): Promise<number> {
    const started = Date.now();
    while (!this.closed) {
      if (Date.now() - started > timeoutMs) throw new Error("not closed");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return this.closed.code;
  }
}

async function open(): Promise<Client> {
  const response = await SELF.fetch(`${BASE}/rooms/${room.sid}/ws`, { headers: { Upgrade: "websocket" } });
  return new Client(response.webSocket!);
}

async function join(pid: string, role: "host" | "guest", overrides = {}) {
  const client = await open();
  client.send({ type: "auth", token: await roomToken(pid, role, overrides) });
  return client;
}

async function service(action: string, body: unknown = {}) {
  return SELF.fetch(`${BASE}/rooms/${room.sid}/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await serviceToken()}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  room.sid = crypto.randomUUID();
});

describe("room", () => {
  it("welcomes participants and broadcasts presence", async () => {
    const host = await join(HOST, "host");
    const welcome = await host.next((message) => message.type === "welcome");
    expect(welcome.self).toEqual({ pid: HOST, name: "ホスト", role: "host" });
    expect(typeof welcome.serverTime).toBe("number");

    const guest = await join(GUEST, "guest");
    await guest.next((message) => message.type === "welcome");
    const state = await host.next(
      (message) => message.type === "state" && message.state.participants.length === 2,
    );
    expect(state.state.participants.map((p: Message) => [p.pid, p.connected])).toEqual([
      [HOST, true],
      [GUEST, true],
    ]);
  });

  it("answers pings with the server time", async () => {
    const guest = await join(GUEST, "guest");
    await guest.next((message) => message.type === "welcome");
    guest.send({ type: "ping", t0: 123.5 });
    const pong = await guest.next((message) => message.type === "pong");
    expect(pong.t0).toBe(123.5);
    expect(Math.abs(pong.serverTime - Date.now())).toBeLessThan(5_000);
  });

  it("rejects bad tokens and messages before auth", async () => {
    const client = await open();
    client.send({ type: "ping", t0: 1 });
    expect(await client.waitClosed()).toBe(4001);

    const forged = await join(GUEST, "guest", { sid: crypto.randomUUID() });
    expect(await forged.waitClosed()).toBe(4001);
  });

  it("enforces the number of people connected at once", async () => {
    await (await join(HOST, "host", { maxp: 2 })).next((m) => m.type === "welcome");
    await (await join(GUEST, "guest", { maxp: 2 })).next((m) => m.type === "welcome");
    const third = await join(GUEST2, "guest", { maxp: 2 });
    expect(await third.waitClosed()).toBe(4005);
  });

  it("replaces the old connection when the same participant joins again", async () => {
    const first = await join(GUEST, "guest");
    await first.next((m) => m.type === "welcome");
    const second = await join(GUEST, "guest");
    await second.next((m) => m.type === "welcome");
    expect(await first.waitClosed()).toBe(4002);
  });

  it("broadcasts start and stop, and kicks participants", async () => {
    const host = await join(HOST, "host");
    const guest = await join(GUEST, "guest");
    await guest.next((m) => m.type === "welcome");

    await service("control", { action: "start" });
    const started = await guest.next((m) => m.type === "state" && m.state.status === "recording");
    expect(typeof started.state.startedAtMs).toBe("number");

    await service("kick", { participantId: GUEST });
    await guest.next((m) => m.type === "kicked");
    expect(await guest.waitClosed()).toBe(4003);
    await host.next(
      (m) => m.type === "state" && m.state.participants.every((p: Message) => p.pid !== GUEST),
    );

    // 退出させられた参加者は同じトークンでは入り直せない
    const again = await join(GUEST, "guest");
    expect(await again.waitClosed()).toBe(4003);
  });

  it("only publishes tracks from SFU sessions the participant created", async () => {
    const host = await join(HOST, "host");
    await host.next((m) => m.type === "welcome");
    host.send({ type: "track", sessionId: "not-mine", trackName: "mic" });
    host.send({ type: "ping", t0: 1 });
    await host.next((m) => m.type === "pong");
    const last = [...host.messages].reverse().find((m) => m.type === "state");
    expect(last?.state.participants[0].track).toBeNull();
  });

  it("tells everyone and disconnects when the room closes", async () => {
    const guest = await join(GUEST, "guest");
    await guest.next((m) => m.type === "welcome");
    await service("close");
    await guest.next((m) => m.type === "closed");
    expect(await guest.waitClosed()).toBe(4004);
    const late = await SELF.fetch(`${BASE}/rooms/${room.sid}/ws`, { headers: { Upgrade: "websocket" } });
    expect(late.status).toBe(410);
  });

  it("relays chat to everyone and shows recent chat to people who join later", async () => {
    const host = await join(HOST, "host");
    const guest = await join(GUEST, "guest");
    await guest.next((m) => m.type === "welcome");
    guest.send({ type: "chat", text: "  音が途切れました  " });
    const received = await host.next((m) => m.type === "chat");
    expect(received.message).toMatchObject({ pid: GUEST, name: "ゲスト", text: "音が途切れました" });
    await guest.next((m) => m.type === "chat");

    const late = await join(GUEST2, "guest");
    const welcome = await late.next((m) => m.type === "welcome");
    expect(welcome.chat.map((m: Message) => m.text)).toEqual(["音が途切れました"]);
  });

  it("limits chat length and rate", async () => {
    const guest = await join(GUEST, "guest");
    await guest.next((m) => m.type === "welcome");
    guest.send({ type: "chat", text: "あ".repeat(501) });
    expect((await guest.next((m) => m.type === "error")).code).toBe("chat_too_long");
    for (let i = 0; i < 6; i += 1) guest.send({ type: "chat", text: `メッセージ${i}` });
    expect((await guest.next((m) => m.type === "error" && m.code === "chat_rate_limited")).code).toBe("chat_rate_limited");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(guest.messages.filter((m) => m.type === "chat")).toHaveLength(5);
  });

  it("reports participant status to others", async () => {
    const host = await join(HOST, "host");
    const guest = await join(GUEST, "guest");
    await guest.next((m) => m.type === "welcome");
    guest.send({ type: "status", mic: "muted", recorder: "recording", pendingChunks: 2, flushed: false });
    const state = await host.next(
      (m) =>
        m.type === "state" &&
        m.state.participants.some((p: Message) => p.pid === GUEST && p.mic === "muted" && p.pendingChunks === 2),
    );
    expect(state).toBeTruthy();
  });
});
