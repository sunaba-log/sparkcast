import { describe, expect, it, vi } from "vitest";
import {
  expireStaleRecordingSessions,
  getRecordingSession,
  listEpisodeStatuses,
  listRecordingSessions,
} from "@/server/recording/repository";

const SESSION_ID = "6f9619ff-8b86-4011-b42d-00c04fc964ff";

describe("expireStaleRecordingSessions", () => {
  it("expires only waiting rooms and stops recording rooms so they can still be finalized", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ status: "expired" }, { status: "expired" }, { status: "uploading" }] })
      .mockResolvedValueOnce({ rowCount: 0 });

    await expect(expireStaleRecordingSessions({ query } as never, 180)).resolves.toEqual({
      expired: 2,
      stopped: 1,
      failed: 0,
    });

    const [settleSql] = query.mock.calls[0];
    expect(settleSql).toContain("WHEN 'waiting' THEN 'expired' ELSE 'uploading'");
    // 録音が残っている uploading は対象にしない
    expect(settleSql).toContain("WHERE status IN ('waiting', 'recording') AND expires_at < now()");
    expect(query.mock.calls[1]).toEqual([expect.stringContaining("WHERE status = 'mixing'"), [180]]);
  });
});

describe("reading sessions", () => {
  it("settles an expired session before reading it, without waiting for the daily cron", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await getRecordingSession({ query } as never, SESSION_ID);

    expect(query.mock.calls[0]).toEqual([
      expect.stringMatching(/UPDATE recording_sessions[\s\S]*expires_at < now\(\) AND session_id = \$1/),
      [SESSION_ID],
    ]);
    expect(query.mock.calls[1][0]).toContain("SELECT");
  });

  it("settles expired sessions of the podcast before listing them", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await listRecordingSessions({ query } as never, 7);

    expect(query.mock.calls[0]).toEqual([
      expect.stringMatching(/expires_at < now\(\) AND podcast_id = \$1/),
      [7],
    ]);
  });
});

describe("listEpisodeStatuses", () => {
  it("skips the query when there are no episodes", async () => {
    const query = vi.fn();
    await expect(listEpisodeStatuses({ query } as never, [])).resolves.toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });

  it("maps episode ids to statuses", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ episode_id: 21, status: "failed" }] });
    await expect(listEpisodeStatuses({ query } as never, [21, 22])).resolves.toEqual(new Map([[21, "failed"]]));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ANY($1::int[])"), [[21, 22]]);
  });
});
