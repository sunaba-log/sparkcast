import { NextResponse } from "next/server";
import { getDbPool } from "@/server/db";
import { getCronSecret } from "@/server/env";
import { markAbandonedUploadsFailed } from "@/server/episodes/repository";
import { expireStaleRecordingSessions } from "@/server/recording/repository";

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${getCronSecret()}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const updated = await markAbandonedUploadsFailed(24 * 60);
  // 収録ルーム（#166）: 期限切れと、ミックスが 3 時間以上止まったもの
  const recording = await expireStaleRecordingSessions(await getDbPool(), 3 * 60);
  return NextResponse.json({ updated, recording });
}
