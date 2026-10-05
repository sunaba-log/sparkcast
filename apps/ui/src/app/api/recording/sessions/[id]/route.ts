import { NextResponse } from "next/server";
import { loadHostSession, recordingErrorResponse } from "@/server/recording/context";
import { buildSessionView } from "@/server/recording/view";

export const runtime = "nodejs";

// ホスト向けのセッション詳細（参加者・トラック・エピソードの処理状態）
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const loaded = await loadHostSession((await context.params).id);
    if (!loaded.ok) return loaded.response;
    const view = await buildSessionView(loaded.deps.pool, loaded.deps.roomSecret, loaded.session);
    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return recordingErrorResponse(error, "Failed to load recording session");
  }
}
