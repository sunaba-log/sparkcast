import { z } from "zod";

export const MAX_MP3_SIZE_BYTES = 500 * 1024 * 1024;

export const createEpisodeUploadSchema = z.object({
  podcastId: z.number().int().positive(),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(10_000).optional(),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.literal("audio/mpeg"),
  fileSize: z.number().int().positive().max(MAX_MP3_SIZE_BYTES),
});

export type CreateEpisodeUploadInput = z.infer<typeof createEpisodeUploadSchema>;

export type CreateEpisodeUploadResponse = {
  episodeId: number;
  podcastId: number;
  objectPath: string;
  uploadUrl: string;
  expiresAt: string;
};

export function sanitizeFileName(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).pop() ?? "";
  if (!baseName.toLowerCase().endsWith(".mp3")) {
    throw new Error("MP3ファイルを選択してください");
  }

  const sanitizedStem = baseName
    .slice(0, -4)
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "audio";

  return `${sanitizedStem}.mp3`;
}

export function buildEpisodeSourceObjectPath(
  podcastId: number,
  episodeId: number,
  fileName: string,
): string {
  return `podcasts/${podcastId}/episodes/${episodeId}/source/${sanitizeFileName(fileName)}`;
}
