import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDbPool } from "@/server/db";
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
  try {
    const token = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    if (!token.email) return null;
    return {
      uid: token.uid,
      email: token.email,
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
