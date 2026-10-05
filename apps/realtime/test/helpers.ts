import { base64UrlEncode, hmacSha256 } from "../src/tokens";

export const ROOM_SECRET = "test-room-secret";
export const SERVICE_SECRET = "test-service-secret";
// テスト間で Durable Object・R2 の状態が持ち越されるため、ルーム ID はテストごとに変える
export const room = { sid: crypto.randomUUID() };
export const HOST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const GUEST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const GUEST2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const encoder = new TextEncoder();

async function sign(payload: object, secret: string): Promise<string> {
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = base64UrlEncode(await hmacSha256(secret, `${header}.${body}`));
  return `${header}.${body}.${signature}`;
}

export function roomToken(
  pid: string,
  role: "host" | "guest",
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      aud: "sparkcast-room",
      sid: room.sid,
      pid,
      role,
      name: role === "host" ? "ホスト" : "ゲスト",
      maxp: 3,
      rexp: now + 3600,
      iat: now,
      exp: now + 600,
      ...overrides,
    },
    ROOM_SECRET,
  );
}

export function serviceToken(sid = room.sid): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ aud: "sparkcast-service", sid, iat: now, exp: now + 60 }, SERVICE_SECRET);
}
