import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import type { SessionUser } from "@/server/auth";
import { checkUsageAllowed, recordUsage } from "@/server/usage-limit";

const mockPool = {
  query: vi.fn(),
} as unknown as Pool;

const pendingUser: SessionUser = {
  uid: "user-pending",
  email: "user@example.com",
  displayName: "Test User",
  registered: true,
  approvalStatus: "pending_approval",
  isAdmin: false,
};

const activeUser: SessionUser = {
  uid: "user-active",
  email: "user@example.com",
  displayName: "Test User",
  registered: true,
  approvalStatus: "active",
  isAdmin: false,
};

describe("usage-limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkUsageAllowed", () => {
    it("allows pending user when under chat limit", async () => {
      const pool = mockPool as any;
      pool.query.mockResolvedValueOnce({ rows: [{ count: 2 }] });

      const result = await checkUsageAllowed(pool, pendingUser, "chat");

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("blocks pending user when at chat limit", async () => {
      const pool = mockPool as any;
      pool.query.mockResolvedValueOnce({ rows: [{ count: 5 }] });

      const result = await checkUsageAllowed(pool, pendingUser, "chat");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("お試し枠");
    });

    it("allows pending user when under episode upload limit", async () => {
      const pool = mockPool as any;
      pool.query.mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const result = await checkUsageAllowed(pool, pendingUser, "episode_upload");

      expect(result.allowed).toBe(true);
    });

    it("blocks pending user when at episode upload limit", async () => {
      const pool = mockPool as any;
      pool.query.mockResolvedValueOnce({ rows: [{ count: 2 }] });

      const result = await checkUsageAllowed(pool, pendingUser, "episode_upload");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("お試し枠");
    });

    it("allows active user when under hourly limit", async () => {
      const pool = mockPool as any;
      pool.query.mockResolvedValueOnce({ rows: [{ count: 10 }] });
      pool.query.mockResolvedValueOnce({ rows: [{ count: 30 }] });

      const result = await checkUsageAllowed(pool, activeUser, "chat");

      expect(result.allowed).toBe(true);
    });

    it("blocks active user when at hourly limit", async () => {
      const pool = mockPool as any;
      pool.query.mockResolvedValueOnce({ rows: [{ count: 20 }] });

      const result = await checkUsageAllowed(pool, activeUser, "chat");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("上限に達しました");
    });

    it("blocks active user when at daily limit", async () => {
      const pool = mockPool as any;
      pool.query.mockResolvedValueOnce({ rows: [{ count: 10 }] });
      pool.query.mockResolvedValueOnce({ rows: [{ count: 100 }] });

      const result = await checkUsageAllowed(pool, activeUser, "chat");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("1日");
    });

    it("allows active user for episode upload (no limit)", async () => {
      const result = await checkUsageAllowed(
        mockPool as any,
        activeUser,
        "episode_upload",
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe("recordUsage", () => {
    it("inserts usage log", async () => {
      const pool = mockPool as any;
      pool.query.mockResolvedValueOnce({});

      await recordUsage(pool, "user-123", "chat");

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO api_usage_logs"),
        ["user-123", "chat"],
      );
    });
  });
});
