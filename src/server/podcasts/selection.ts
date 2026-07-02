import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  hasPodcastAccess,
  requirePodcastAccess,
  type SessionUser,
} from "@/server/auth";

export const SELECTED_PODCAST_COOKIE_NAME = "selected_podcast_id";

const SELECTED_PODCAST_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export function selectedPodcastCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SELECTED_PODCAST_MAX_AGE_SECONDS,
  };
}

export async function getSelectedPodcastId(): Promise<number | null> {
  const raw = (await cookies()).get(SELECTED_PODCAST_COOKIE_NAME)?.value;
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

// ページ用。未選択・アクセス権なしはチャンネル一覧へ誘導する
export async function requireSelectedPodcast(
  user: SessionUser,
): Promise<number> {
  const podcastId = await getSelectedPodcastId();
  if (!podcastId || !(await hasPodcastAccess(user.uid, podcastId))) {
    redirect("/channels");
  }
  return podcastId;
}

// API用。未選択は NO_PODCAST_SELECTED、アクセス権なしは FORBIDDEN を投げる
export async function requireSelectedPodcastForApi(
  user: SessionUser,
): Promise<number> {
  const podcastId = await getSelectedPodcastId();
  if (!podcastId) throw new Error("NO_PODCAST_SELECTED");
  await requirePodcastAccess(user.uid, podcastId);
  return podcastId;
}
