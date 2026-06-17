import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function getDatabaseUrl(): string {
  return required("DATABASE_URL");
}

export function getUploadBucket(): string {
  return required("GCS_UPLOAD_BUCKET");
}

export function getSignedUrlTtlMs(): number {
  const raw = process.env.GCS_SIGNED_URL_TTL_SECONDS ?? "900";
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new Error("GCS_SIGNED_URL_TTL_SECONDS must be a positive integer");
  }
  return seconds * 1000;
}
