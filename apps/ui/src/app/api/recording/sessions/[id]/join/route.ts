import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, hasPodcastAccess } from "@/server/auth";
import { isRecordingEnabled } from "@/server/env";
import {
  buildRecordingDeps,
  recordingDisabledResponse,
  recordingErrorResponse,
  recordingNotAllowedResponse,
} from "@/server/recording/context";
import { getRecordingSession } from "@/server/recording/repository";
import { joinAsGuest, joinAsHost } from "@/server/recording/service";

export const runtime = "nodejs";

const displayName = z
  .string()
  .trim()
  .min(1, "表示名を入力してください")
  .max(30, "表示名は 30 文字以内にしてください")
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "使えない文字が含まれています");

const guestSchema = z.object({
  inviteKey: z.string().min(16).max(64),
  displayName,
  consent: z.boolean(),
  participantId: z.string().uuid().optional(),
  rejoinKey: z.string().min(16).max(64).optional(),
});

const hostSchema = z.object({
  displayName: displayName.optional(),
});

// 入室（トークンの発行・更新）。招待キー付きならゲスト、無ければログイン中のホスト。
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isRecordingEnabled()) return recordingDisabledResponse();
  try {
    const sessionId = (await context.params).id;
    const body = (await request.json()) as Record<string, unknown>;
    const deps = await buildRecordingDeps();

    if (typeof body.inviteKey === "string") {
      const input = guestSchema.parse(body);
      const result = await joinAsGuest(deps, { sessionId, ...input });
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    if (!user.canRecord) return recordingNotAllowedResponse();
    const input = hostSchema.parse(body);
    const session = await getRecordingSession(deps.pool, sessionId);
    if (!session || !(await hasPodcastAccess(user.uid, session.podcastId))) {
      return NextResponse.json({ error: "収録ルームが見つかりません" }, { status: 404 });
    }
    const result = await joinAsHost(deps, {
      session,
      userId: user.uid,
      displayName: input.displayName || user.displayName || "ホスト",
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return recordingErrorResponse(error, "Failed to join recording session");
  }
}
