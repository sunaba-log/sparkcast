import { describe, expect, it, vi } from "vitest";
import {
  setEpisodePublished,
  deleteEpisodeRecord,
  markEpisodeAuditing,
  updateEpisodeMetadata,
} from "@/server/episodes/data-repository";
import { getDbPool } from "@/server/db";

vi.mock("@/server/db", () => ({
  getDbPool: vi.fn(),
}));

vi.mock("@/server/firebase-admin", () => ({
  getAdminFirestore: vi.fn(() => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            delete: vi.fn().mockResolvedValue(undefined),
          })),
        })),
        delete: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  })),
}));

describe("data-repository episode management", () => {
  it("sets episode published_at to date when published=true", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    vi.mocked(getDbPool).mockResolvedValue({ query: mockQuery } as never);

    const result = await setEpisodePublished(1, 42, true);
    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE episodes\n     SET published_at = $1"),
      [expect.any(Date), 1, 42],
    );
  });

  it("sets episode published_at to null when published=false", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    vi.mocked(getDbPool).mockResolvedValue({ query: mockQuery } as never);

    const result = await setEpisodePublished(1, 42, false);
    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE episodes\n     SET published_at = $1"),
      [null, 1, 42],
    );
  });

  it("deletes episode record from postgres and firestore", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    vi.mocked(getDbPool).mockResolvedValue({ query: mockQuery } as never);

    const result = await deleteEpisodeRecord(1, 42);
    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM episodes"),
      [1, 42],
    );
  });

  it("marks episode status as auditing", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    vi.mocked(getDbPool).mockResolvedValue({ query: mockQuery } as never);

    const result = await markEpisodeAuditing(1, 42);
    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'auditing'"),
      [1, 42],
    );
  });

  it("updates episode metadata title and description", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    vi.mocked(getDbPool).mockResolvedValue({ query: mockQuery } as never);

    const result = await updateEpisodeMetadata(1, 42, "New Title", "New Desc");
    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET title = COALESCE($1, title)"),
      ["New Title", "New Desc", 1, 42],
    );
  });
});
