import { NextResponse } from "next/server";
import { getCronSecret, getDefaultPodcastId } from "@/server/env";
import { reindexPodcastMinutes } from "@/server/chat/reindex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 配信済み議事録の埋め込みインデックスを定期的に更新する（冪等。新規・変更分のみ）。
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${getCronSecret()}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await reindexPodcastMinutes(getDefaultPodcastId());
  return NextResponse.json(result);
}
