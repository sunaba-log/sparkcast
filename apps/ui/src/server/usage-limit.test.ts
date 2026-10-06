import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "pg";
import type { SessionUser } from "@/server/auth";
import { checkUsageAllowed, recordUsage, reserveUsage } from "@/server/usage-limit";

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
  canRecord: false,
};

const activeUser: SessionUser = {
  uid: "user-active",
  email: "user@example.com",
  displayName: "Test User",
  registered: true,
  approvalStatus: "active",
  isAdmin: false,
  canRecord: false,
};

describe("usage-limit", () => {
  beforeEach(() => {
    (mockPool.query as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  describe("checkUsageAllowed", () => {
    it("allows pending user when under chat limit", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ count: 2 }],
      });

      const result = await checkUsageAllowed(mockPool, pendingUser, "chat");

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("blocks pending user when at chat limit", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ count: 5 }],
      });

      const result = await checkUsageAllowed(mockPool, pendingUser, "chat");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("お試し枠");
    });

    it("allows pending user when under episode upload limit", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ count: 1 }],
      });

      const result = await checkUsageAllowed(
        mockPool,
        pendingUser,
        "episode_upload",
      );

      expect(result.allowed).toBe(true);
    });

    it("blocks pending user when at episode upload limit", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ count: 2 }],
      });

      const result = await checkUsageAllowed(
        mockPool,
        pendingUser,
        "episode_upload",
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("お試し枠");
    });

    it("allows active user when under hourly limit", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rows: [{ count: 10 }] })
        .mockResolvedValueOnce({ rows: [{ count: 30 }] });

      const result = await checkUsageAllowed(mockPool, activeUser, "chat");

      expect(result.allowed).toBe(true);
    });

    it("blocks active user when at hourly limit", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rows: [{ count: 20 }] })
        .mockResolvedValueOnce({ rows: [{ count: 20 }] });

      const result = await checkUsageAllowed(mockPool, activeUser, "chat");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("上限に達しました");
    });

    it("blocks active user when at daily limit", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rows: [{ count: 10 }] })
        .mockResolvedValueOnce({ rows: [{ count: 100 }] });

      const result = await checkUsageAllowed(mockPool, activeUser, "chat");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("1日");
    });

    it("allows active user for episode upload (no limit)", async () => {
      const result = await checkUsageAllowed(
        mockPool,
        activeUser,
        "episode_upload",
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe("recordUsage", () => {
    it("inserts usage log", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});

      await recordUsage(mockPool, "user-123", "chat");

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO api_usage_logs"),
        ["user-123", "chat"],
      );
    });
  });
});

describe("reserveUsage", () => {
  function clientWith(count: number) {
    const query = vi.fn(async (sql: string) =>
      sql.includes("COUNT(*)") ? { rows: [{ count }] } : { rows: [] },
    );
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
    return { pool, client, query };
  }

  it("checks and records under a per-user lock in one transaction", async () => {
    const { pool, client, query } = clientWith(0);
    const result = await reserveUsage(pool, activeUser, "chat");
    expect(result.allowed).toBe(true);
    const sqls = query.mock.calls.map(([sql]) => String(sql));
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls[1]).toContain("pg_advisory_xact_lock");
    expect(sqls.some((sql) => sql.includes("INSERT INTO api_usage_logs"))).toBe(true);
    expect(sqls.at(-1)).toBe("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });

  it("does not record when the limit is reached", async () => {
    const { pool, query } = clientWith(5);
    const result = await reserveUsage(pool, pendingUser, "chat");
    expect(result.allowed).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT"))).toBe(false);
  });
});
