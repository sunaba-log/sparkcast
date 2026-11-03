import "server-only";

import type { SessionUser } from "@/server/auth";
import { getGuestEmail, isGuestModeEnabled } from "@/server/env";

// ゲストモードの共有アカウントか。審査員など複数人が同じアカウントに入るので、
// 他の人のサンプルを消せる操作（削除・退会・連携設定の変更）は禁止する。
export function isGuestUser(user: Pick<SessionUser, "email">): boolean {
  return isGuestModeEnabled() && user.email === getGuestEmail();
}

export const GUEST_FORBIDDEN_MESSAGE =
  "お試しアカウントでは、削除・退会・連携設定の変更はできません";
