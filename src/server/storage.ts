import "server-only";

import { Storage } from "@google-cloud/storage";
import { getSignedUrlTtlMs, getUploadBucket } from "@/server/env";

declare global {
  var podcastStorage: Storage | undefined;
}

function getStorage(): Storage {
  if (!globalThis.podcastStorage) {
    globalThis.podcastStorage = new Storage();
  }
  return globalThis.podcastStorage;
}

export async function createMp3UploadUrl(
  objectPath: string,
): Promise<{ uploadUrl: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + getSignedUrlTtlMs());
  const [uploadUrl] = await getStorage()
    .bucket(getUploadBucket())
    .file(objectPath)
    .getSignedUrl({
      version: "v4",
      action: "write",
      expires: expiresAt,
      contentType: "audio/mpeg",
    });

  return { uploadUrl, expiresAt };
}

