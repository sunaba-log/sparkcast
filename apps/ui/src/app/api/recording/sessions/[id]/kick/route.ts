import { NextResponse } from "next/server";
import { z } from "zod";
import { loadHostSession, recordingErrorResponse } from "@/server/recording/context";
import { removeParticipant } from "@/server/recording/service";

export const runtime = "nodejs";

const kickSchema = z.object({ participantId: z.string().uuid() });

// ゲストを退出させる（ホスト）。同じ招待 URL・同じ端末からは入り直せなくなる。
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const loaded = await loadHostSession((await context.params).id);
    if (!loaded.ok) return loaded.response;
    const { participantId } = kickSchema.parse(await request.json());
    await removeParticipant(loaded.deps, loaded.session, participantId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return recordingErrorResponse(error, "Failed to remove participant");
  }
}
