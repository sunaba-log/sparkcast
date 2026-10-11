import { describe, expect, it, vi } from "vitest";
import {
  findEpisode,
  setEpisodePublished,
  deleteEpisodeRecord,
  markEpisodeAuditing,
  updateEpisodeAudio,
  updateEpisodeMetadata,
} from "@/server/episodes/data-repository";
import { getDbPool } from "@/server/db";
import { getAdminFirestore } from "@/server/firebase-admin";

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
            get: vi.fn().mockResolvedValue({ data: () => ({}) }),
            set: vi.fn().mockResolvedValue(undefined),
          })),
        })),
        delete: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue({ data: () => ({}) }),
        set: vi.fn().mockResolvedValue(undefined),
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

  it("updates episode audio with metadata", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    vi.mocked(getDbPool).mockResolvedValue({ query: mockQuery } as never);

    const result = await updateEpisodeAudio({
      podcastId: 1,
      episodeId: 42,
      audioUrl: "https://example.com/audio.mp3?v=123",
      durationSeconds: 3661,
      fileSizeBytes: 123456,
      mimeType: "audio/mpeg",
    });
    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET audio_file_path = $1"),
      ["https://example.com/audio.mp3?v=123", 3661, 1, 42],
    );
  });
});

 describe("episode preview URLs", () => {
  it.each(["awaiting_approval", "awaiting_publish_confirmation", "completed", "upload_pending"])("returns source preview independently of publication for %s", async (status) => {
    const collection = { get: vi.fn().mockResolvedValue({ docs: [] }), orderBy: vi.fn() };
    collection.orderBy.mockReturnValue(collection);
    const content = { get: vi.fn().mockResolvedValue({ data: () => ({ minutes: "minutes" }) }), collection: vi.fn(() => collection) };
    vi.mocked(getAdminFirestore).mockReturnValue({ collection: () => ({ doc: () => ({ collection: () => ({ doc: () => content }) }) }) } as never);
    vi.mocked(getDbPool).mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [{
      episode_id: 42, podcast_id: 1, title: "Episode", description: null,
      source_audio_path: "podcasts/1/episodes/42/source/audio.m4a",
      audio_file_path: "https://example.com/edited.mp3", status,
      created_at: new Date(), published_at: null, artwork_url: null, processing_error: null,
    }] }) } as never);
    const episode = await findEpisode(1, 42);
    expect(episode?.sourceAudioUrl).toBe(status === "upload_pending" ? null : "/api/episodes/42/source-audio");
    expect(episode?.audioUrl).toBe(status === "completed" ? "https://example.com/edited.mp3" : null);
    expect(episode?.isPublished).toBe(false);
  });
});
