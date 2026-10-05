import { NextResponse } from "next/server";
import { getCronSecret } from "@/server/env";
import { reindexPodcastKnowledge } from "@/server/chat/reindex";
import { listAllPodcastIds } from "@/server/podcasts/data-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// チャット知識源（議事録・次回議題・SNS 投稿）の埋め込みインデックスを定期的に更新する
// （冪等。新規・変更分のみ）。
// ?podcastId=N を付けるとその番組だけ（エピソードが完成した直後に automator が呼ぶ。#166）。
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${getCronSecret()}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const requested = new URL(request.url).searchParams.get("podcastId");
  if (requested !== null && !/^[1-9][0-9]*$/.test(requested)) {
    return NextResponse.json({ error: "podcastId が正しくありません" }, { status: 400 });
  }
  const podcastIds = requested !== null ? [Number(requested)] : await listAllPodcastIds();
  const results = [];
  for (const podcastId of podcastIds) {
    results.push({ podcastId, ...(await reindexPodcastKnowledge(podcastId)) });
  }
  return NextResponse.json({ results });
}
