import { describe, expect, it } from "vitest";
import {
  buildEpisodeSourceObjectPath,
  buildRecordingSourceObjectPath,
  createEpisodeUploadSchema,
  MAX_AUDIO_SIZE_BYTES,
  sanitizeFileName,
} from "@/server/episodes/upload-contract";

describe("episode upload contract", () => {
  it("builds the object path used by podcast-automator", () => {
    expect(buildEpisodeSourceObjectPath(12, 34, "my episode.mp3")).toBe(
      "podcasts/12/episodes/34/source/my-episode.mp3",
    );
    expect(buildEpisodeSourceObjectPath(12, 34, "my episode.m4a")).toBe(
      "podcasts/12/episodes/34/source/my-episode.m4a",
    );
  });

  it("removes directories and unsafe characters from filenames", () => {
    expect(sanitizeFileName("../../収録 01.mp3")).toBe("01.mp3");
    expect(sanitizeFileName("収録.m4a")).toBe("audio.m4a");
  });

  it("rejects unsupported filenames", () => {
    expect(() => sanitizeFileName("episode.wav")).toThrow("MP3またはM4A");
  });

  it("validates API input", () => {
    expect(() =>
      createEpisodeUploadSchema.parse({
        podcastId: 1,
        title: "Episode",
        fileName: "episode.mp3",
        contentType: "audio/mpeg",
        fileSize: MAX_AUDIO_SIZE_BYTES + 1,
      }),
    ).toThrow();
  });

  it("accepts m4a API input", () => {
    expect(() =>
      createEpisodeUploadSchema.parse({
        podcastId: 1,
        fileName: "episode.m4a",
        contentType: "audio/mp4",
        fileSize: MAX_AUDIO_SIZE_BYTES,
      }),
    ).not.toThrow();
  });
});

describe("buildRecordingSourceObjectPath", () => {
  it("builds a FLAC path inside the episode source prefix", () => {
    expect(
      buildRecordingSourceObjectPath(7, 42, "11111111-1111-4111-8111-111111111111"),
    ).toBe("podcasts/7/episodes/42/source/recording-11111111.flac");
  });
});
