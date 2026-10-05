import { NextResponse } from "next/server";
import { loadHostSession, recordingErrorResponse } from "@/server/recording/context";
import { getRecordingSession } from "@/server/recording/repository";
import { finalizeRecording } from "@/server/recording/service";
import { buildSessionView } from "@/server/recording/view";

export const runtime = "nodejs";

// 収録を確定してエピソードを作り、mixer を起動する（ホスト）
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const loaded = await loadHostSession((await context.params).id);
    if (!loaded.ok) return loaded.response;
    await finalizeRecording(loaded.deps, loaded.session);
    const session = await getRecordingSession(loaded.deps.pool, loaded.session.sessionId);
    return NextResponse.json(
      await buildSessionView(loaded.deps.pool, loaded.deps.roomSecret, session ?? loaded.session),
    );
  } catch (error) {
    return recordingErrorResponse(error, "Failed to finalize recording");
  }
}
