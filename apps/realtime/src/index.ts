import type { Env } from "./env";
import type { ChunkRecord } from "./room";
import {
  verifyFileSignature,
  verifyRoomToken,
  verifyServiceToken,
  type RoomTokenClaims,
} from "./tokens";

import { buildChunkKey, isAllowedOrigin, MAX_CHUNK_BYTES } from "./shared";

// Workers のメインモジュールはハンドラとクラス以外を export できない（起動時に失敗する）。
// 関数や定数は ./shared に置く。
export { Room } from "./room";

// sparkcast 収録ルームの Worker（#166）。
//
// ブラウザ向け（room JWT）:
//   GET  /rooms/:sid/ws                     WebSocket（最初のメッセージで JWT を渡す）
//   ANY  /rooms/:sid/sfu/*                  Realtime SFU API のプロキシ（partytracks の prefix）
//   PUT  /rooms/:sid/chunks?...             録音チャンクの受け口（R2 に保存して台帳に記録）
// UI 向け（service JWT）:
//   POST /rooms/:sid/control | kick | close | manifest
//   GET  /rooms/:sid/files?key&exp&sig     話者別トラックのダウンロード（署名付き URL）

const DEFAULT_REALTIME_API = "https://rtc.live.cloudflare.com/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEGMENT = /^[A-Za-z0-9-]{1,48}$/;
const MIME_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
};

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin || !isAllowedOrigin(origin, env)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function withCors(response: Response, cors: Record<string, string>): Response {
  if (Object.keys(cors).length === 0 || response.status === 101) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

function roomStub(env: Env, sid: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(sid));
}

async function requireParticipant(request: Request, env: Env, sid: string): Promise<RoomTokenClaims | Response> {
  const token = bearer(request);
  const claims = token ? await verifyRoomToken(token, env.ROOM_SECRET) : null;
  if (!claims || claims.sid !== sid) return json({ error: "unauthorized" }, 401);
  return claims;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    try {
      return withCors(await route(request, env), cors);
    } catch (error) {
      console.error("Unhandled error", error);
      return withCors(json({ error: "internal error" }, 500), cors);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") return json({ ok: true });

  const match = url.pathname.match(/^\/rooms\/([^/]+)\/(ws|sfu|chunks|control|kick|close|manifest|files)(\/.*)?$/);
  if (!match) return json({ error: "not found" }, 404);
  const [, sid, action, rest = ""] = match;
  if (!UUID.test(sid)) return json({ error: "not found" }, 404);

  switch (action) {
    case "ws":
      return handleWebSocket(request, env, sid);
    case "sfu":
      return handleSfu(request, env, sid, rest);
    case "chunks":
      return handleChunk(request, env, sid, url);
    case "files":
      return handleFile(request, env, sid, url);
    default:
      return handleService(request, env, sid, action);
  }
}

async function handleWebSocket(request: Request, env: Env, sid: string): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return json({ error: "expected websocket" }, 426);
  }
  if (Object.keys(corsHeaders(request, env)).length === 0 && request.headers.has("Origin")) {
    return json({ error: "origin not allowed" }, 403);
  }
  const headers = new Headers(request.headers);
  headers.set("X-Room-Id", sid);
  return roomStub(env, sid).fetch(new Request(request.url, { headers }));
}

// ---- Realtime SFU プロキシ ----
// partytracks（ブラウザ）は prefix 配下の sessions/new・sessions/:id/tracks/new などを呼ぶ。
// SFU のアプリトークンはここでだけ付け、参加者は自分が作った SFU セッションしか操作できない。

async function handleSfu(request: Request, env: Env, sid: string, rest: string): Promise<Response> {
  const claims = await requireParticipant(request, env, sid);
  if (claims instanceof Response) return claims;
  const stub = roomStub(env, sid);
  if (!(await stub.isActiveParticipant(claims.pid))) return json({ error: "forbidden" }, 403);

  const apiBase = env.REALTIME_API_BASE_URL ?? DEFAULT_REALTIME_API;

  if (rest === "/generate-ice-servers") {
    if (env.TURN_KEY_ID && env.TURN_KEY_TOKEN) {
      const response = await fetch(`${apiBase}/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.TURN_KEY_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 4 * 60 * 60 }),
      });
      return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json" } });
    }
    return json({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] }] });
  }

  const url = new URL(request.url);
  const target = new URL(`${apiBase}/apps/${env.SFU_APP_ID}${rest}`);
  target.search = url.search;
  const body = request.method === "GET" || request.method === "HEAD" ? null : await request.text();
  const init: RequestInit = {
    method: request.method,
    headers: { Authorization: `Bearer ${env.SFU_APP_TOKEN}`, "Content-Type": "application/json" },
    body,
  };

  if (rest === "/sessions/new") {
    const response = await fetch(target, init);
    const text = await response.text();
    if (response.ok) {
      const created = JSON.parse(text) as { sessionId?: string };
      if (created.sessionId) await stub.registerSfuSession(claims.pid, created.sessionId);
    }
    return new Response(text, { status: response.status, headers: { "Content-Type": "application/json" } });
  }

  const sessionMatch = rest.match(/^\/sessions\/([A-Za-z0-9_-]+)\/(tracks\/new|tracks\/update|tracks\/close|renegotiate)$/);
  if (!sessionMatch) return json({ error: "not found" }, 404);
  const [, sfuSessionId, operation] = sessionMatch;
  if (!(await stub.ownsSfuSession(claims.pid, sfuSessionId))) return json({ error: "forbidden" }, 403);

  if (operation === "tracks/new" && body) {
    // pull する相手（remote）が同じルームの参加者かを確かめる
    const parsed = JSON.parse(body) as { tracks?: { location?: string; sessionId?: string }[] };
    const remoteSessionIds = (parsed.tracks ?? [])
      .filter((track) => track.location === "remote")
      .map((track) => String(track.sessionId ?? ""));
    if (remoteSessionIds.length > 0 && !(await stub.sfuSessionsInRoom(remoteSessionIds))) {
      return json({ error: "forbidden" }, 403);
    }
  }

  const response = await fetch(target, init);
  return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json" } });
}

// ---- 録音チャンク ----

function intParam(url: URL, name: string, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

async function handleChunk(request: Request, env: Env, sid: string, url: URL): Promise<Response> {
  if (request.method !== "PUT") return json({ error: "method not allowed" }, 405);
  const claims = await requireParticipant(request, env, sid);
  if (claims instanceof Response) return claims;

  const kind = url.searchParams.get("kind");
  const subject = url.searchParams.get("subject") ?? claims.pid;
  const segment = url.searchParams.get("segment") ?? "";
  const seq = intParam(url, "seq", { max: 1_000_000 });
  const segmentStartMs = intParam(url, "segmentStart");
  const chunkStartMs = intParam(url, "chunkStart");
  const durationMs = url.searchParams.has("duration") ? intParam(url, "duration", { max: 600_000 }) : null;
  const sampleRate = url.searchParams.has("rate") ? intParam(url, "rate", { min: 8_000, max: 192_000 }) : null;
  const mime = (request.headers.get("Content-Type") ?? "").split(";")[0].trim();
  const extension = MIME_EXTENSIONS[mime];

  if (
    (kind !== "local" && kind !== "backup") ||
    !UUID.test(subject) ||
    !SEGMENT.test(segment) ||
    seq === null ||
    segmentStartMs === null ||
    chunkStartMs === null ||
    !extension
  ) {
    return json({ error: "invalid chunk parameters" }, 400);
  }
  // 本人の録音は本人だけが、バックアップ（他人の受信音声）はホストだけが送れる
  if (kind === "local" && subject !== claims.pid) return json({ error: "forbidden" }, 403);
  if (kind === "backup" && (claims.role !== "host" || subject === claims.pid)) {
    return json({ error: "forbidden" }, 403);
  }

  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (declaredLength > MAX_CHUNK_BYTES) return json({ error: "chunk too large" }, 413);
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json({ error: "empty chunk" }, 400);
  if (body.byteLength > MAX_CHUNK_BYTES) return json({ error: "chunk too large" }, 413);

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
  const sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const key = buildChunkKey(sid, kind, subject, segment, seq, extension);
  const record: ChunkRecord = {
    kind,
    participantId: subject,
    uploaderId: claims.pid,
    segment,
    seq,
    segmentStartMs,
    chunkStartMs,
    durationMs,
    bytes: body.byteLength,
    sha256,
    mime,
    sampleRate,
    key,
    uploadedAtMs: Date.now(),
  };

  const stub = roomStub(env, sid);
  // 受け付けられる状態かを先に確かめてから保存し、保存できたら台帳に載せる
  if (!(await stub.isActiveParticipant(claims.pid))) return json({ error: "forbidden" }, 403);
  await env.RECORDINGS.put(key, body, {
    sha256: digest,
    httpMetadata: { contentType: mime },
    customMetadata: {
      uploader: claims.pid,
      segmentStartMs: String(segmentStartMs),
      chunkStartMs: String(chunkStartMs),
    },
  });
  const result = await stub.recordChunk(record);
  if (!result.ok) {
    await env.RECORDINGS.delete(key);
    return json({ error: result.reason }, 409);
  }
  return json({ ok: true, key, sha256 }, 201);
}

// ---- UI 向けの内部 API ----

async function handleService(request: Request, env: Env, sid: string, action: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const token = bearer(request);
  const claims = token ? await verifyServiceToken(token, env.SERVICE_SECRET) : null;
  if (!claims || claims.sid !== sid) return json({ error: "unauthorized" }, 401);

  const stub = roomStub(env, sid);
  await stub.setRoomId(sid);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  switch (action) {
    case "control": {
      if (body.action !== "start" && body.action !== "stop") return json({ error: "invalid action" }, 400);
      return json(await stub.control(body.action));
    }
    case "kick": {
      if (typeof body.participantId !== "string" || !UUID.test(body.participantId)) {
        return json({ error: "invalid participant" }, 400);
      }
      await stub.kick(body.participantId);
      return json({ ok: true });
    }
    case "close":
      await stub.close();
      return json({ ok: true });
    case "manifest": {
      const manifest = await stub.manifest();
      await env.RECORDINGS.put(`sessions/${sid}/manifest.json`, JSON.stringify(manifest), {
        httpMetadata: { contentType: "application/json" },
      });
      return json(manifest);
    }
    default:
      return json({ error: "not found" }, 404);
  }
}

async function handleFile(request: Request, env: Env, sid: string, url: URL): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
  const key = url.searchParams.get("key") ?? "";
  const exp = Number(url.searchParams.get("exp"));
  const signature = url.searchParams.get("sig") ?? "";
  if (!key.startsWith(`sessions/${sid}/`) || key.includes("..")) return json({ error: "not found" }, 404);
  if (!(await verifyFileSignature(env.SERVICE_SECRET, sid, key, exp, signature))) {
    return json({ error: "forbidden" }, 403);
  }
  const object = await env.RECORDINGS.get(key);
  if (!object) return json({ error: "not found" }, 404);
  const fileName = key.split("/").pop() ?? "track";
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Content-Length": String(object.size),
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
