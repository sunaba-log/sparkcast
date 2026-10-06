import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/server/db", () => ({ getDbPool: vi.fn() }));
vi.mock("@/server/firebase-admin", () => ({ getAdminAuth: vi.fn() }));

const { canUseRecording } = await import("@/server/auth");

describe("canUseRecording (#174)", () => {
  it("admin は許可の列に関わらず使える", () => {
    expect(canUseRecording(true, false)).toBe(true);
    expect(canUseRecording(true, undefined)).toBe(true);
  });

  it("admin 以外は、管理画面で許可したユーザーだけが使える", () => {
    expect(canUseRecording(false, true)).toBe(true);
    expect(canUseRecording(false, false)).toBe(false);
    // users に行が無い（未登録・お試し）
    expect(canUseRecording(false, undefined)).toBe(false);
  });
});
