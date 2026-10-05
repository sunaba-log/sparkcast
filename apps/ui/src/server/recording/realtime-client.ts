import { signServiceToken } from "@/server/recording/tokens";
import { createHmac } from "node:crypto";

// UI（Cloud Run）から Cloudflare Worker（apps/realtime）の内部 API を呼ぶクライアント。
// 認証は aud=sparkcast-service の短命 JWT（RECORDING_SERVICE_SECRET）。

export type ManifestChunk = {
  kind: "local" | "backup";
  participantId: string;
  uploaderId: string;
  segment: string;
  seq: number;
  segmentStartMs: number;
  chunkStartMs: number;
  durationMs: number | null;
  bytes: number;
  sha256: string;
  mime: string;
  sampleRate: number | null;
  key: string;
  uploadedAtMs: number;
};

export type RecordingManifest = {
  sessionId: string;
  recording: { startedAtMs: number | null; stoppedAtMs: number | null };
  participants: { participantId: string; name: string; role: "host" | "guest" }[];
  chunks: ManifestChunk[];
};

export type RoomControlResult = {
  status: "idle" | "recording" | "stopped" | "closed";
  startedAtMs: number | null;
  stoppedAtMs: number | null;
};

type Config = {
  baseUrl: string;
  serviceSecret: string;
  fetchImpl?: typeof fetch;
};

export class RealtimeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(
  config: Config,
  sessionId: string,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const token = await signServiceToken(sessionId, config.serviceSecret);
  const response = await (config.fetchImpl ?? fetch)(
    `${config.baseUrl}/rooms/${sessionId}${path}`,
    {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new RealtimeApiError(
      `Realtime API ${init.method} ${path} failed: ${response.status} ${text.slice(0, 200)}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export function controlRoom(
  config: Config,
  sessionId: string,
  action: "start" | "stop",
): Promise<RoomControlResult> {
  return call(config, sessionId, "/control", { method: "POST", body: { action } });
}

export function kickParticipant(
  config: Config,
  sessionId: string,
  participantId: string,
): Promise<{ ok: true }> {
  return call(config, sessionId, "/kick", { method: "POST", body: { participantId } });
}

export function closeRoom(config: Config, sessionId: string): Promise<{ ok: true }> {
  return call(config, sessionId, "/close", { method: "POST", body: {} });
}

// Durable Object の台帳を R2（sessions/{sid}/manifest.json）に書き出させ、その内容を受け取る
export function snapshotManifest(
  config: Config,
  sessionId: string,
): Promise<RecordingManifest> {
  return call(config, sessionId, "/manifest", { method: "POST", body: {} });
}

// R2 の録音ファイルを Worker 経由でダウンロードする短命 URL。
// 署名形式は apps/realtime/src/index.ts の verifyFileSignature と揃える。
export function createFileDownloadUrl(
  config: Pick<Config, "baseUrl" | "serviceSecret">,
  sessionId: string,
  objectKey: string,
  ttlSeconds = 600,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const exp = nowSeconds + ttlSeconds;
  const signature = createHmac("sha256", config.serviceSecret)
    .update(`file:${sessionId}:${objectKey}:${exp}`)
    .digest("base64url");
  const params = new URLSearchParams({ key: objectKey, exp: String(exp), sig: signature });
  return `${config.baseUrl}/rooms/${sessionId}/files?${params.toString()}`;
}
