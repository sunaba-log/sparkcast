import "server-only";

// 収録ルームのトークン（#166）。Cloudflare Worker（apps/realtime/src/tokens.ts）と
// 同じ形式・同じ秘密で検証するため、WebCrypto だけで実装している。形式を変えるときは
// 両方のテストにある固定ベクタを揃えて更新すること。
//
// - room token   : 参加者が Worker に接続・録音を送るための JWT（RECORDING_ROOM_SECRET）
// - service token: UI → Worker の内部 API 用 JWT（RECORDING_SERVICE_SECRET）
// - invite key   : 招待 URL の鍵。セッション ID の HMAC なので DB に保存しない
// - rejoin key   : リロード後に同じ参加者として入り直すための鍵（参加者 ID の HMAC）

export const ROOM_TOKEN_AUDIENCE = "sparkcast-room";
export const SERVICE_TOKEN_AUDIENCE = "sparkcast-service";

export type ParticipantRole = "host" | "guest";

export type RoomTokenClaims = {
  aud: typeof ROOM_TOKEN_AUDIENCE;
  sid: string;
  pid: string;
  role: ParticipantRole;
  name: string;
  maxp: number;
  // ルーム自体の有効期限（UNIX 秒）。Worker はこれを過ぎた接続を拒否する。
  rexp: number;
  iat: number;
  exp: number;
};

export type ServiceTokenClaims = {
  aud: typeof SERVICE_TOKEN_AUDIENCE;
  sid: string;
  iat: number;
  exp: number;
};

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncode(encoder.encode(JSON.stringify(value)));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function signJwt(payload: object, secret: string): Promise<string> {
  const header = base64UrlEncodeJson({ alg: "HS256", typ: "JWT" });
  const body = base64UrlEncodeJson(payload);
  const signature = base64UrlEncode(await hmac(secret, `${header}.${body}`));
  return `${header}.${body}.${signature}`;
}

export async function verifyJwt<T extends { aud: string; exp: number }>(
  token: string,
  secret: string,
  audience: T["aud"],
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<T | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = base64UrlEncode(await hmac(secret, `${header}.${body}`));
  if (!timingSafeEqualString(signature, expected)) return null;
  try {
    const decodedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    if (decodedHeader.alg !== "HS256") return null;
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    if (claims.aud !== audience) return null;
    if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function signRoomToken(
  claims: Omit<RoomTokenClaims, "aud" | "iat" | "exp">,
  secret: string,
  ttlSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ token: string; expiresAt: number }> {
  // ルームの期限を超える JWT は出さない
  const exp = Math.min(nowSeconds + ttlSeconds, claims.rexp);
  const payload: RoomTokenClaims = {
    aud: ROOM_TOKEN_AUDIENCE,
    ...claims,
    iat: nowSeconds,
    exp,
  };
  return { token: await signJwt(payload, secret), expiresAt: exp };
}

export async function signServiceToken(
  sessionId: string,
  secret: string,
  ttlSeconds = 60,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: ServiceTokenClaims = {
    aud: SERVICE_TOKEN_AUDIENCE,
    sid: sessionId,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  };
  return signJwt(payload, secret);
}

async function derivedKey(secret: string, purpose: string, id: string): Promise<string> {
  // 128bit を超える長さ（24 バイト = 192bit）に切り詰めて URL を短くする
  return base64UrlEncode((await hmac(secret, `${purpose}:${id}`)).slice(0, 24));
}

export function createInviteKey(sessionId: string, secret: string): Promise<string> {
  return derivedKey(secret, "invite", sessionId);
}

export async function verifyInviteKey(
  sessionId: string,
  key: string,
  secret: string,
): Promise<boolean> {
  return timingSafeEqualString(key, await createInviteKey(sessionId, secret));
}

export function createRejoinKey(participantId: string, secret: string): Promise<string> {
  return derivedKey(secret, "rejoin", participantId);
}

export async function verifyRejoinKey(
  participantId: string,
  key: string,
  secret: string,
): Promise<boolean> {
  return timingSafeEqualString(key, await createRejoinKey(participantId, secret));
}
