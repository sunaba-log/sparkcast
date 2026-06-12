import { describe, expect, it } from "vitest";
import {
  buildEpisodeSourceObjectPath,
  createEpisodeUploadSchema,
  MAX_MP3_SIZE_BYTES,
  sanitizeFileName,
} from "@/server/episodes/upload-contract";

describe("episode upload contract", () => {
  it("builds the object path used by podcast-automator", () => {
    expect(buildEpisodeSourceObjectPath(12, 34, "my episode.mp3")).toBe(
      "podcasts/12/episodes/34/source/my-episode.mp3",
    );
  });

  it("removes directories and unsafe characters from filenames", () => {
    expect(sanitizeFileName("../../収録 01.mp3")).toBe("01.mp3");
    expect(sanitizeFileName("収録.mp3")).toBe("audio.mp3");
  });

  it("rejects non-MP3 filenames", () => {
    expect(() => sanitizeFileName("episode.wav")).toThrow("MP3");
  });

  it("validates API input", () => {
    expect(() =>
      createEpisodeUploadSchema.parse({
        podcastId: 1,
        title: "Episode",
        fileName: "episode.mp3",
        contentType: "audio/mpeg",
        fileSize: MAX_MP3_SIZE_BYTES + 1,
      }),
    ).toThrow();
  });
});
