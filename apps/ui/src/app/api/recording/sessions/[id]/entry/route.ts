import { NextResponse } from "next/server";
import { z } from "zod";
import { loadHostSession, recordingErrorResponse } from "@/server/recording/context";
import { setEntryLocked } from "@/server/recording/repository";

export const runtime = "nodejs";

const entrySchema = z.object({ locked: z.boolean() });

// 入室の締め切りを切り替える（ホスト）。締め切っている間は新しいゲストを入れない（入室済みの人は入り直せる）。
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const loaded = await loadHostSession((await context.params).id);
    if (!loaded.ok) return loaded.response;
    const { locked } = entrySchema.parse(await request.json());
    const updated = await setEntryLocked(loaded.deps.pool, loaded.session.sessionId, locked);
    if (!updated) {
      return NextResponse.json({ error: "このルームは終了しています" }, { status: 409 });
    }
    return NextResponse.json({ entryLocked: updated.entryLocked });
  } catch (error) {
    return recordingErrorResponse(error, "Failed to change the entry lock");
  }
}
