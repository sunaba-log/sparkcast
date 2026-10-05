import type { Env } from "./env";

// 1 チャンクの上限（10 秒の WAV でも 1MB 程度。余裕を見て 8MB）
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

export function isAllowedOrigin(origin: string, env: Pick<Env, "ALLOWED_ORIGINS" | "ALLOWED_ORIGIN_PATTERN">): boolean {
  const allowed = env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  return !!env.ALLOWED_ORIGIN_PATTERN && new RegExp(env.ALLOWED_ORIGIN_PATTERN).test(origin);
}

export function buildChunkKey(
  sid: string,
  kind: "local" | "backup",
  participantId: string,
  segment: string,
  seq: number,
  extension: string,
): string {
  return `sessions/${sid}/${kind}/${participantId}/${segment}/${String(seq).padStart(6, "0")}.${extension}`;
}
