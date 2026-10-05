import { NextResponse } from "next/server";
import { loadHostSession, recordingErrorResponse } from "@/server/recording/context";
import { createFileDownloadUrl } from "@/server/recording/realtime-client";
import { listTrackSummaries } from "@/server/recording/repository";

export const runtime = "nodejs";

// mixer が位置合わせした話者別 FLAC のダウンロード（ホスト）。Worker の短命 URL へ転送する。
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; participantId: string }> },
) {
  try {
    const params = await context.params;
    const loaded = await loadHostSession(params.id);
    if (!loaded.ok) return loaded.response;
    const tracks = await listTrackSummaries(loaded.deps.pool, loaded.session.sessionId);
    const track = tracks.find(
      (candidate) =>
        candidate.participantId === params.participantId && candidate.alignedObjectKey,
    );
    if (!track?.alignedObjectKey) {
      return NextResponse.json({ error: "トラックが見つかりません" }, { status: 404 });
    }
    return NextResponse.redirect(
      createFileDownloadUrl(
        { baseUrl: loaded.deps.realtimeBaseUrl, serviceSecret: loaded.deps.serviceSecret },
        loaded.session.sessionId,
        track.alignedObjectKey,
      ),
      302,
    );
  } catch (error) {
    return recordingErrorResponse(error, "Failed to create track download URL");
  }
}
