// 収録ルームのトークン検証（#166）。発行側は apps/ui/src/server/recording/tokens.ts。
// 形式を変えるときは両方のテストにある固定ベクタを揃えて更新すること。

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
const decoder = new TextDecoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
  const expected = base64UrlEncode(await hmacSha256(secret, `${header}.${body}`));
  if (!timingSafeEqualString(signature, expected)) return null;
  try {
    const decodedHeader = JSON.parse(decoder.decode(base64UrlDecode(header))) as { alg?: string };
    if (decodedHeader.alg !== "HS256") return null;
    const claims = JSON.parse(decoder.decode(base64UrlDecode(body))) as T;
    if (claims.aud !== audience) return null;
    if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) return null;
    return claims;
  } catch {
    return null;
  }
}

export function verifyRoomToken(token: string, secret: string, nowSeconds?: number) {
  return verifyJwt<RoomTokenClaims>(token, secret, ROOM_TOKEN_AUDIENCE, nowSeconds);
}

export function verifyServiceToken(token: string, secret: string, nowSeconds?: number) {
  return verifyJwt<ServiceTokenClaims>(token, secret, SERVICE_TOKEN_AUDIENCE, nowSeconds);
}

// ダウンロード用の短命 URL の署名。発行側は apps/ui/src/server/recording/realtime-client.ts
export async function verifyFileSignature(
  secret: string,
  sessionId: string,
  key: string,
  exp: number,
  signature: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!Number.isInteger(exp) || exp <= nowSeconds) return false;
  const expected = base64UrlEncode(await hmacSha256(secret, `file:${sessionId}:${key}:${exp}`));
  return timingSafeEqualString(signature, expected);
}
