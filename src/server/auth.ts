import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDbPool } from "@/server/db";
import { isLocalMockAuthEnabled } from "@/server/env";
import { getAdminAuth } from "@/server/firebase-admin";

export const SESSION_COOKIE_NAME = "podcast_session";

export type SessionUser = {
  uid: string;
  email: string;
  displayName: string | null;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  if (
    process.env.NODE_ENV !== "production" &&
    isLocalMockAuthEnabled() &&
    sessionCookie.startsWith("mock_session:")
  ) {
    const email = sessionCookie.slice("mock_session:".length).toLowerCase();
    try {
      const user = await (await getDbPool()).query<{
        user_id: string;
        display_name: string | null;
      }>("SELECT user_id, display_name FROM users WHERE email = $1", [email]);
      if (user.rows.length === 0) return null;
      return {
        uid: user.rows[0].user_id,
        email,
        displayName: user.rows[0].display_name ?? "Dev Mock User",
      };
    } catch {
      return null;
    }
  }

  try {
    const token = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    if (!token.email) return null;
    const email = token.email.toLowerCase();
    const user = await (await getDbPool()).query<{ user_id: string }>(
      "SELECT user_id FROM users WHERE email = $1",
      [email],
    );
    return {
      uid: user.rows[0]?.user_id ?? token.uid,
      email,
      displayName: typeof token.name === "string" ? token.name : null,
    };
  } catch {
    return null;
  }
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function hasPodcastAccess(
  userId: string,
  podcastId: number,
): Promise<boolean> {
  const result = await (await getDbPool()).query(
    `SELECT 1
     FROM podcast_ownerships
     WHERE user_id = $1
       AND podcast_id = $2
       AND role IN ('owner', 'editor')`,
    [userId, podcastId],
  );
  return result.rowCount === 1;
}

export async function requirePodcastAccess(
  userId: string,
  podcastId: number,
): Promise<void> {
  if (!(await hasPodcastAccess(userId, podcastId))) {
    throw new Error("FORBIDDEN");
  }
}
