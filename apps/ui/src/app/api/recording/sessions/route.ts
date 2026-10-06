import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, requirePodcastAccess } from "@/server/auth";
import { getDbPool } from "@/server/db";
import { isRecordingEnabled } from "@/server/env";
import {
  buildRecordingDeps,
  recordingDisabledResponse,
  recordingErrorResponse,
  recordingNotAllowedResponse,
} from "@/server/recording/context";
import { createSession } from "@/server/recording/service";
import { checkUsageAllowed, recordUsage } from "@/server/usage-limit";

export const runtime = "nodejs";

const createSchema = z.object({
  podcastId: z.number().int().positive(),
  title: z.string().trim().max(255).optional(),
});

// 収録ルームを作成する（ホスト）
export async function POST(request: Request) {
  if (!isRecordingEnabled()) return recordingDisabledResponse();
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    if (!user.registered) {
      return NextResponse.json({ error: "ユーザー登録が必要です" }, { status: 403 });
    }
    if (!user.canRecord) return recordingNotAllowedResponse();
    const input = createSchema.parse(await request.json());
    await requirePodcastAccess(user.uid, input.podcastId);

    const pool = await getDbPool();
    const usage = await checkUsageAllowed(pool, user, "recording_session");
    if (!usage.allowed) {
      return NextResponse.json({ error: usage.reason }, { status: 429 });
    }
    await recordUsage(pool, user.uid, "recording_session");

    const deps = await buildRecordingDeps();

    const { session, invitePath } = await createSession(deps, {
      podcastId: input.podcastId,
      hostUserId: user.uid,
      title: input.title || null,
    });
    return NextResponse.json({ sessionId: session.sessionId, invitePath }, { status: 201 });
  } catch (error) {
    return recordingErrorResponse(error, "Failed to create recording session");
  }
}
