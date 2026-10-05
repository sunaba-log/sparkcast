import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { base64UrlEncode, hmacSha256, verifyRoomToken } from "../src/tokens";
import { GUEST, GUEST2, HOST, room, roomToken, serviceToken, SERVICE_SECRET } from "./helpers";

const BASE = "https://realtime.test";

async function service(action: string, body: unknown = {}) {
  return SELF.fetch(`${BASE}/rooms/${room.sid}/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await serviceToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function putChunk(
  token: string,
  params: Record<string, string | number>,
  body: BodyInit = new Uint8Array([1, 2, 3, 4]),
  contentType = "audio/webm",
) {
  const query = new URLSearchParams(
    Object.fromEntries(
      Object.entries({ kind: "local", segment: "seg-1", seq: 0, segmentStart: 1000, chunkStart: 1000, ...params }).map(
        ([key, value]) => [key, String(value)],
      ),
    ),
  );
  return SELF.fetch(`${BASE}/rooms/${room.sid}/chunks?${query}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
}

// WebSocket で入室させる（Durable Object に参加者として載る）
async function connect(token: string): Promise<{ ws: WebSocket; messages: Record<string, unknown>[] }> {
  const response = await SELF.fetch(`${BASE}/rooms/${room.sid}/ws`, { headers: { Upgrade: "websocket" } });
  const ws = response.webSocket!;
  const messages: Record<string, unknown>[] = [];
  const welcomed = new Promise<void>((resolve, reject) => {
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      messages.push(message);
      if (message.type === "welcome") resolve();
    });
    ws.addEventListener("close", (event) => reject(new Error(`closed ${event.code}`)));
  });
  ws.accept();
  ws.send(JSON.stringify({ type: "auth", token }));
  await welcomed;
  return { ws, messages };
}

async function joinAll() {
  const host = await connect(await roomToken(HOST, "host"));
  const guest = await connect(await roomToken(GUEST, "guest"));
  return { host, guest };
}

beforeEach(() => {
  room.sid = crypto.randomUUID();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tokens", () => {
  it("verifies the fixed vector issued by apps/ui", async () => {
    const token =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJzcGFya2Nhc3Qtcm9vbSIsInNpZCI6IjExMTExMTExLTExMTEtNDExMS04MTExLTExMTExMTExMTExMSIsInBpZCI6IjIyMjIyMjIyLTIyMjItNDIyMi04MjIyLTIyMjIyMjIyMjIyMiIsInJvbGUiOiJndWVzdCIsIm5hbWUiOiLjgrLjgrnjg4giLCJtYXhwIjo2LCJyZXhwIjoxODAwMDAzNjAwLCJpYXQiOjE4MDAwMDAwMDAsImV4cCI6MTgwMDAwMDYwMH0.QqbsNPY2a6FH6zZgQvwmi5Jkj5tkDge3hm2KLm6DMgA";
    const claims = await verifyRoomToken(token, "test-room-secret", 1_800_000_000);
    expect(claims).toMatchObject({ pid: "22222222-2222-4222-8222-222222222222", name: "ゲスト", maxp: 6 });
    expect(await verifyRoomToken(token, "test-room-secret", 1_800_000_600)).toBeNull();
    expect(await verifyRoomToken(token, "other", 1_800_000_000)).toBeNull();
  });
});

describe("service API", () => {
  it("rejects calls without a service token or for another room", async () => {
    const anonymous = await SELF.fetch(`${BASE}/rooms/${room.sid}/control`, { method: "POST", body: "{}" });
    expect(anonymous.status).toBe(401);
    const other = await SELF.fetch(`${BASE}/rooms/${room.sid}/control`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await serviceToken(crypto.randomUUID())}` },
      body: JSON.stringify({ action: "start" }),
    });
    expect(other.status).toBe(401);
    // room token は service API に使えない
    const withRoomToken = await SELF.fetch(`${BASE}/rooms/${room.sid}/control`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await roomToken(HOST, "host")}` },
      body: JSON.stringify({ action: "start" }),
    });
    expect(withRoomToken.status).toBe(401);
  });

  it("starts and stops the recording with server timestamps", async () => {
    const started = (await (await service("control", { action: "start" })).json()) as Record<string, unknown>;
    expect(started.status).toBe("recording");
    expect(typeof started.startedAtMs).toBe("number");
    // 二度目の start は開始時刻を変えない
    const again = (await (await service("control", { action: "start" })).json()) as Record<string, unknown>;
    expect(again.startedAtMs).toBe(started.startedAtMs);
    const stopped = (await (await service("control", { action: "stop" })).json()) as Record<string, unknown>;
    expect(stopped.status).toBe("stopped");
    expect(stopped.stoppedAtMs).toBeGreaterThanOrEqual(started.startedAtMs as number);
  });
});

describe("chunk upload", () => {
  it("refuses chunks before the recording starts and leaves nothing in R2", async () => {
    await joinAll();
    const response = await putChunk(await roomToken(HOST, "host"), {});
    expect(response.status).toBe(409);
    const listed = await env.RECORDINGS.list({ prefix: `sessions/${room.sid}/` });
    expect(listed.objects).toHaveLength(0);
  });

  it("stores local and backup chunks under keys derived from the token", async () => {
    await joinAll();
    await service("control", { action: "start" });
    const hostToken = await roomToken(HOST, "host");
    const guestToken = await roomToken(GUEST, "guest");

    const local = await putChunk(guestToken, { seq: 3, duration: 30000 });
    expect(local.status).toBe(201);
    const localBody = (await local.json()) as { key: string };
    expect(localBody.key).toBe(`sessions/${room.sid}/local/${GUEST}/seg-1/000003.webm`);

    const backup = await putChunk(hostToken, { kind: "backup", subject: GUEST, segment: "b-1" });
    expect(backup.status).toBe(201);

    const stored = await env.RECORDINGS.get(localBody.key);
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));

    const manifest = (await (await service("manifest")).json()) as {
      chunks: { key: string; uploaderId: string; durationMs: number | null; sha256: string }[];
    };
    expect(manifest.chunks.map((chunk) => chunk.key).sort()).toEqual([
      `sessions/${room.sid}/backup/${GUEST}/b-1/000000.webm`,
      `sessions/${room.sid}/local/${GUEST}/seg-1/000003.webm`,
    ]);
    expect(manifest.chunks.find((chunk) => chunk.key.includes("/local/"))?.durationMs).toBe(30000);
    expect(manifest.chunks[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    // 台帳は R2 にも書き出される（mixer が読む）
    expect(await env.RECORDINGS.get(`sessions/${room.sid}/manifest.json`)).not.toBeNull();
  });

  it("accepts chunks from a participant whose WebSocket has not authenticated yet", async () => {
    await service("control", { action: "start" });
    expect((await putChunk(await roomToken(GUEST2, "guest"), { subject: GUEST2 })).status).toBe(201);
  });

  it("only lets participants write their own track, and only the host write backups", async () => {
    await joinAll();
    await service("control", { action: "start" });
    const guestToken = await roomToken(GUEST, "guest");
    expect((await putChunk(guestToken, { subject: GUEST2 })).status).toBe(403);
    expect((await putChunk(guestToken, { kind: "backup", subject: HOST })).status).toBe(403);
    expect((await putChunk(await roomToken(HOST, "host"), { kind: "backup", subject: HOST })).status).toBe(403);
  });

  it("validates parameters, type and size", async () => {
    await joinAll();
    await service("control", { action: "start" });
    const token = await roomToken(GUEST, "guest");
    expect((await putChunk(token, { segment: "../x" })).status).toBe(400);
    expect((await putChunk(token, { seq: -1 })).status).toBe(400);
    expect((await putChunk(token, {}, new Uint8Array([1]), "text/html")).status).toBe(400);
    expect((await putChunk(token, {}, new Uint8Array(0))).status).toBe(400);
    expect((await putChunk(token, {}, new Uint8Array(8 * 1024 * 1024 + 1))).status).toBe(413);
  });

  it("rejects tokens for another room or with a bad signature", async () => {
    await service("control", { action: "start" });
    const otherRoom = await roomToken(GUEST, "guest", { sid: "22222222-2222-4222-8222-222222222222" });
    expect((await putChunk(otherRoom, {})).status).toBe(401);
    const token = await roomToken(GUEST, "guest");
    expect((await putChunk(`${token.slice(0, -2)}xx`, {})).status).toBe(401);
  });

  it("stops accepting chunks from a kicked guest and after the room closes", async () => {
    await joinAll();
    await service("control", { action: "start" });
    const guestToken = await roomToken(GUEST, "guest");
    await service("kick", { participantId: GUEST });
    expect((await putChunk(guestToken, {})).status).toBe(403);

    const hostToken = await roomToken(HOST, "host");
    expect((await putChunk(hostToken, {})).status).toBe(201);
    await service("close");
    expect((await putChunk(hostToken, { seq: 1 })).status).toBe(403);
  });
});

describe("file download", () => {
  async function signedUrl(key: string, exp: number) {
    const signature = base64UrlEncode(await hmacSha256(SERVICE_SECRET, `file:${room.sid}:${key}:${exp}`));
    return `${BASE}/rooms/${room.sid}/files?${new URLSearchParams({ key, exp: String(exp), sig: signature })}`;
  }

  it("serves objects only with a valid, unexpired signature for this room", async () => {
    const key = `sessions/${room.sid}/aligned/${GUEST}.flac`;
    await env.RECORDINGS.put(key, "flac-bytes", { httpMetadata: { contentType: "audio/flac" } });
    const exp = Math.floor(Date.now() / 1000) + 60;

    const ok = await SELF.fetch(await signedUrl(key, exp));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Disposition")).toContain(`${GUEST}.flac`);
    expect(await ok.text()).toBe("flac-bytes");

    const tampered = new URL(await signedUrl(key, exp));
    tampered.searchParams.set("exp", String(exp + 1));
    expect((await SELF.fetch(tampered)).status).toBe(403);
    expect((await SELF.fetch(await signedUrl(key, Math.floor(Date.now() / 1000) - 1))).status).toBe(403);
    expect((await SELF.fetch(await signedUrl("sessions/other/x.flac", exp))).status).toBe(404);
  });
});

describe("SFU proxy", () => {
  function mockSfu() {
    const calls: { url: string; body: string | null; auth: string | null }[] = [];
    let counter = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const body = typeof init?.body === "string" ? init.body : null;
      const auth = new Headers(init?.headers).get("Authorization");
      calls.push({ url, body, auth });
      if (url.endsWith("/sessions/new")) {
        counter += 1;
        return new Response(JSON.stringify({ sessionId: `sfu-${counter}` }), { status: 201 });
      }
      return new Response(JSON.stringify({ tracks: [] }), { status: 200 });
    });
    return calls;
  }

  async function sfu(token: string, path: string, body: unknown = {}) {
    return SELF.fetch(`${BASE}/rooms/${room.sid}/sfu${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("forwards with the app token and only lets the creator use a SFU session", async () => {
    await joinAll();
    const calls = mockSfu();
    const hostToken = await roomToken(HOST, "host");
    const guestToken = await roomToken(GUEST, "guest");

    const created = await sfu(hostToken, "/sessions/new");
    expect(created.status).toBe(201);
    expect(calls[0]).toMatchObject({ url: "https://sfu.test/v1/apps/test-app/sessions/new", auth: "Bearer test-app-token" });
    const guestCreated = await sfu(guestToken, "/sessions/new");
    expect(((await guestCreated.json()) as { sessionId: string }).sessionId).toBe("sfu-2");

    // 他人の SFU セッションは操作できない
    expect((await sfu(guestToken, "/sessions/sfu-1/tracks/close")).status).toBe(403);
    // 同じルームの参加者のトラックは pull できる
    const pull = await sfu(guestToken, "/sessions/sfu-2/tracks/new", {
      tracks: [{ location: "remote", sessionId: "sfu-1", trackName: "mic" }],
    });
    expect(pull.status).toBe(200);
    // ルーム外のセッションは pull できない
    const outside = await sfu(guestToken, "/sessions/sfu-2/tracks/new", {
      tracks: [{ location: "remote", sessionId: "sfu-other-room", trackName: "mic" }],
    });
    expect(outside.status).toBe(403);
  });

  it("requires a room token", async () => {
    mockSfu();
    const response = await SELF.fetch(`${BASE}/rooms/${room.sid}/sfu/sessions/new`, { method: "POST", body: "{}" });
    expect(response.status).toBe(401);
  });

  it("returns STUN servers when TURN is not configured", async () => {
    await joinAll();
    const response = await SELF.fetch(`${BASE}/rooms/${room.sid}/sfu/generate-ice-servers`, {
      headers: { Authorization: `Bearer ${await roomToken(GUEST, "guest")}` },
    });
    const body = (await response.json()) as { iceServers: { urls: string[] }[] };
    expect(body.iceServers[0].urls[0]).toContain("stun:");
  });
});

describe("CORS", () => {
  it("answers preflight only for allowed origins", async () => {
    const allowed = await SELF.fetch(`${BASE}/rooms/${room.sid}/chunks`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000" },
    });
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    const denied = await SELF.fetch(`${BASE}/rooms/${room.sid}/chunks`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    });
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("isAllowedOrigin", () => {
  it("accepts listed origins and the preview pattern only", async () => {
    const { isAllowedOrigin } = await import("../src/shared");
    const env = {
      ALLOWED_ORIGINS: "https://dev.sparkcast.sunabalog.com",
      ALLOWED_ORIGIN_PATTERN: "^https://pr-[0-9]+---sparkcast-ui-dev-jztgcd4mia-an\\.a\\.run\\.app$",
    };
    expect(isAllowedOrigin("https://dev.sparkcast.sunabalog.com", env)).toBe(true);
    expect(isAllowedOrigin("https://pr-166---sparkcast-ui-dev-jztgcd4mia-an.a.run.app", env)).toBe(true);
    expect(isAllowedOrigin("https://pr-166---sparkcast-ui-dev-jztgcd4mia-an.a.run.app.evil.com", env)).toBe(false);
    expect(isAllowedOrigin("https://evil.example", env)).toBe(false);
    expect(isAllowedOrigin("https://evil.example", { ALLOWED_ORIGINS: "" })).toBe(false);
  });
});
