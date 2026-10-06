import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/server/db", () => ({ getDbPool: vi.fn() }));
vi.mock("@/server/firebase-admin", () => ({ getAdminAuth: vi.fn() }));

const { canUseRecording } = await import("@/server/auth");

describe("canUseRecording (#174)", () => {
  it("admin は使える", () => {
    expect(canUseRecording(true, "pending_approval")).toBe(true);
    expect(canUseRecording(true, undefined)).toBe(true);
  });

  it("admin 以外は、制限を解除した（承認した）ユーザーだけが使える", () => {
    expect(canUseRecording(false, "active")).toBe(true);
    expect(canUseRecording(false, "pending_approval")).toBe(false);
    // users に行が無い（未登録）
    expect(canUseRecording(false, undefined)).toBe(false);
  });
});
