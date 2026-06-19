import { describe, expect, it, vi } from "vitest";
import {
  markAbandonedUploadsFailed,
  markEpisodeUploadResult,
} from "@/server/episodes/repository";

describe("markEpisodeUploadResult", () => {
  it("updates only an episode still waiting for upload", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });

    const updated = await markEpisodeUploadResult(
      42,
      "uploaded",
      undefined,
      { query },
    );

    expect(updated).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'upload_pending'"),
      ["uploaded", null, 42],
    );
  });

  it("does not overwrite an automator processing state", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0 });

    await expect(
      markEpisodeUploadResult(42, "failed", "network error", { query }),
    ).resolves.toBe(false);
  });
});

describe("markAbandonedUploadsFailed", () => {
  it("fails only timed-out pending uploads", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 3 });

    await expect(
      markAbandonedUploadsFailed(60, { query }),
    ).resolves.toBe(3);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'upload_pending'"),
      [60],
    );
  });
});
