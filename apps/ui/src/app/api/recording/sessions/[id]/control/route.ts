import { NextResponse } from "next/server";
import { z } from "zod";
import { loadHostSession, recordingErrorResponse } from "@/server/recording/context";
import { controlRecording } from "@/server/recording/service";
import { buildSessionView } from "@/server/recording/view";

export const runtime = "nodejs";

const controlSchema = z.object({ action: z.enum(["start", "stop"]) });

// 収録の開始・停止（ホスト）。Worker が全員に一斉配信する。
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const loaded = await loadHostSession((await context.params).id);
    if (!loaded.ok) return loaded.response;
    const { action } = controlSchema.parse(await request.json());
    const session = await controlRecording(loaded.deps, loaded.session, action);
    return NextResponse.json(
      await buildSessionView(loaded.deps.pool, loaded.deps.roomSecret, session),
    );
  } catch (error) {
    return recordingErrorResponse(error, "Failed to control recording");
  }
}
