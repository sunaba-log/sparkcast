import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getDbPool } from "@/server/db";
import { getSessionUser, hasPodcastAccess, type SessionUser } from "@/server/auth";
import {
  getMixerJobName,
  getRealtimeBaseUrl,
  getRecordingMaxParticipants,
  getRecordingRoomSecret,
  getRecordingRoomTtlHours,
  getRecordingServiceSecret,
  isRecordingEnabled,
} from "@/server/env";
import { runMixerJob } from "@/server/recording/jobs";
import { getRecordingSession, type RecordingSession } from "@/server/recording/repository";
import { RecordingError, type RecordingDeps } from "@/server/recording/service";

export async function buildRecordingDeps(): Promise<RecordingDeps> {
  return {
    pool: await getDbPool(),
    roomSecret: getRecordingRoomSecret(),
    serviceSecret: getRecordingServiceSecret(),
    realtimeBaseUrl: getRealtimeBaseUrl(),
    // mixer はエピソード化のときだけ要る。未設定でも入室などは動くようにする。
    mixerJobName: process.env.MIXER_JOB_NAME ? getMixerJobName() : "",
    maxParticipants: getRecordingMaxParticipants(),
    roomTtlHours: getRecordingRoomTtlHours(),
    runMixerJob: (jobName, input) => {
      if (!jobName) throw new Error("MIXER_JOB_NAME is required");
      return runMixerJob(jobName, input);
    },
  };
}

export function recordingDisabledResponse() {
  return NextResponse.json({ error: "収録機能は無効です" }, { status: 404 });
}

// ホスト（ログイン済みで、そのポッドキャストの owner / editor）だけが操作できるセッションを読む
export async function loadHostSession(
  sessionId: string,
): Promise<
  | { ok: true; user: SessionUser; session: RecordingSession; deps: RecordingDeps }
  | { ok: false; response: NextResponse }
> {
  if (!isRecordingEnabled()) return { ok: false, response: recordingDisabledResponse() };
  const user = await getSessionUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "認証が必要です" }, { status: 401 }),
    };
  }
  const deps = await buildRecordingDeps();
  const session = await getRecordingSession(deps.pool, sessionId);
  if (!session || !(await hasPodcastAccess(user.uid, session.podcastId))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "収録ルームが見つかりません" }, { status: 404 }),
    };
  }
  return { ok: true, user, session, deps };
}

const ERROR_STATUS: Record<RecordingError["code"], number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID_INVITE: 404,
  CLOSED: 410,
  CONSENT_REQUIRED: 400,
  REMOVED: 403,
  PARTICIPANT_LIMIT: 409,
  INVALID_STATE: 409,
  UNAVAILABLE: 503,
};

export function recordingErrorResponse(error: unknown, logMessage: string) {
  if (error instanceof RecordingError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: ERROR_STATUS[error.code] },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "入力内容が不正です", details: error.issues },
      { status: 400 },
    );
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "JSON形式が不正です" }, { status: 400 });
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return NextResponse.json({ error: "操作権限がありません" }, { status: 403 });
  }
  console.error(logMessage, error);
  return NextResponse.json({ error: "処理に失敗しました" }, { status: 500 });
}
