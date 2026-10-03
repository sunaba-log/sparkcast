import type { Room } from "./room";

export type Env = {
  ROOMS: DurableObjectNamespace<Room>;
  RECORDINGS: R2Bucket;
  // 参加者の room JWT（UI と共有）
  ROOM_SECRET: string;
  // UI → Worker の service JWT とダウンロード URL の署名（UI と共有）
  SERVICE_SECRET: string;
  // Cloudflare Realtime SFU / TURN
  SFU_APP_ID: string;
  SFU_APP_TOKEN: string;
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
  // カンマ区切り。ブラウザから呼べるオリジン
  ALLOWED_ORIGINS: string;
  // テストで SFU API の向き先を差し替える
  REALTIME_API_BASE_URL?: string;
};
