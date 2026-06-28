import { NextResponse } from "next/server";
import { getSessionUser, requirePodcastAccess } from "@/server/auth";
import { getDefaultPodcastId } from "@/server/env";
import { reindexPodcastMinutes } from "@/server/chat/reindex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function authorize() {
  const user = await getSessionUser();
  if (!user) return null;
  const podcastId = getDefaultPodcastId();
  await requirePodcastAccess(user.uid, podcastId);
  return { user, podcastId };
}

export async function POST() {
  try {
    const auth = await authorize();
    if (!auth) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const result = await reindexPodcastMinutes(auth.podcastId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "操作権限がありません" }, { status: 403 });
    }
    console.error("Failed to reindex minutes", error);
    return NextResponse.json(
      { error: "インデックス作成に失敗しました" },
      { status: 500 },
    );
  }
}
