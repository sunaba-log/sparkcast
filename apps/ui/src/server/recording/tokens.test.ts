import { describe, expect, it } from "vitest";
import {
  createInviteKey,
  createRejoinKey,
  signJwt,
  signRoomToken,
  signServiceToken,
  verifyInviteKey,
  verifyJwt,
  verifyRejoinKey,
  ROOM_TOKEN_AUDIENCE,
  SERVICE_TOKEN_AUDIENCE,
  type RoomTokenClaims,
} from "@/server/recording/tokens";

const SECRET = "test-room-secret";
const NOW = 1_800_000_000;

// apps/realtime/src/tokens.test.ts と同じ固定ベクタ。形式を変えたら両方を更新する。
const FIXED_ROOM_TOKEN_CLAIMS: RoomTokenClaims = {
  aud: ROOM_TOKEN_AUDIENCE,
  sid: "11111111-1111-4111-8111-111111111111",
  pid: "22222222-2222-4222-8222-222222222222",
  role: "guest",
  name: "ゲスト",
  maxp: 6,
  rexp: NOW + 3600,
  iat: NOW,
  exp: NOW + 600,
};
const FIXED_ROOM_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJzcGFya2Nhc3Qtcm9vbSIsInNpZCI6IjExMTExMTExLTExMTEtNDExMS04MTExLTExMTExMTExMTExMSIsInBpZCI6IjIyMjIyMjIyLTIyMjItNDIyMi04MjIyLTIyMjIyMjIyMjIyMiIsInJvbGUiOiJndWVzdCIsIm5hbWUiOiLjgrLjgrnjg4giLCJtYXhwIjo2LCJyZXhwIjoxODAwMDAzNjAwLCJpYXQiOjE4MDAwMDAwMDAsImV4cCI6MTgwMDAwMDYwMH0.QqbsNPY2a6FH6zZgQvwmi5Jkj5tkDge3hm2KLm6DMgA";

describe("recording tokens", () => {
  it("signs a fixed vector shared with the realtime worker", async () => {
    const token = await signJwt(FIXED_ROOM_TOKEN_CLAIMS, SECRET);
    expect(token).toBe(FIXED_ROOM_TOKEN);
  });

  it("round-trips a room token and rejects the wrong audience or secret", async () => {
    const { token, expiresAt } = await signRoomToken(
      {
        sid: "s",
        pid: "p",
        role: "host",
        name: "ホスト",
        maxp: 4,
        rexp: NOW + 10_000,
      },
      SECRET,
      600,
      NOW,
    );
    expect(expiresAt).toBe(NOW + 600);
    const claims = await verifyJwt<RoomTokenClaims>(token, SECRET, ROOM_TOKEN_AUDIENCE, NOW);
    expect(claims?.pid).toBe("p");
    expect(await verifyJwt(token, SECRET, SERVICE_TOKEN_AUDIENCE, NOW)).toBeNull();
    expect(await verifyJwt(token, "other", ROOM_TOKEN_AUDIENCE, NOW)).toBeNull();
  });

  it("caps the token expiry at the room expiry", async () => {
    const { expiresAt } = await signRoomToken(
      { sid: "s", pid: "p", role: "guest", name: "g", maxp: 4, rexp: NOW + 100 },
      SECRET,
      600,
      NOW,
    );
    expect(expiresAt).toBe(NOW + 100);
  });

  it("rejects expired and tampered tokens", async () => {
    const token = await signServiceToken("s", SECRET, 60, NOW);
    expect(await verifyJwt(token, SECRET, SERVICE_TOKEN_AUDIENCE, NOW + 30)).not.toBeNull();
    expect(await verifyJwt(token, SECRET, SERVICE_TOKEN_AUDIENCE, NOW + 61)).toBeNull();
    const [header, , signature] = token.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ aud: SERVICE_TOKEN_AUDIENCE, sid: "other", iat: NOW, exp: NOW + 60 }),
    ).toString("base64url");
    expect(
      await verifyJwt(`${header}.${forgedBody}.${signature}`, SECRET, SERVICE_TOKEN_AUDIENCE, NOW),
    ).toBeNull();
  });

  it("derives invite and rejoin keys that only match their own id", async () => {
    const invite = await createInviteKey("session-a", SECRET);
    expect(invite).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await verifyInviteKey("session-a", invite, SECRET)).toBe(true);
    expect(await verifyInviteKey("session-b", invite, SECRET)).toBe(false);

    const rejoin = await createRejoinKey("participant-a", SECRET);
    expect(rejoin).not.toBe(invite);
    expect(await verifyRejoinKey("participant-a", rejoin, SECRET)).toBe(true);
    expect(await verifyRejoinKey("participant-b", rejoin, SECRET)).toBe(false);
  });
});
