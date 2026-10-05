import { notFound } from "next/navigation";
import { RecordingSessionList } from "@/components/recording/RecordingSessionList";
import { requireRegisteredUser } from "@/server/auth";
import { getDbPool } from "@/server/db";
import { isRecordingEnabled } from "@/server/env";
import { recordingDisplayStatus } from "@/lib/recording/types";
import { listEpisodeStatuses, listRecordingSessions } from "@/server/recording/repository";
import { requireSelectedPodcast } from "@/server/podcasts/selection";

export const dynamic = "force-dynamic";

export default async function RecordPage() {
  if (!isRecordingEnabled()) notFound();
  const user = await requireRegisteredUser();
  const podcastId = await requireSelectedPodcast(user);
  const pool = await getDbPool();
  const sessions = await listRecordingSessions(pool, podcastId);
  const episodeStatuses = await listEpisodeStatuses(
    pool,
    sessions.flatMap((session) => (session.episodeId === null ? [] : [session.episodeId])),
  );

  return (
    <div className="max-w-3xl">
      <div className="flex items-center text-xs text-gray-500 gap-2 mb-4">
        <span>ホーム</span>
        <span>&gt;</span>
        <span className="font-medium text-gray-800">収録</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900">収録</h1>
      <p className="mt-1 text-sm text-gray-500">
        収録ルームを作って招待 URL を送ると、ゲストはアカウントなしでブラウザから参加できます。
        各自の端末で高音質に録音し、収録後に自動でミックスしてエピソードにします。
      </p>
      <RecordingSessionList
        podcastId={podcastId}
        sessions={sessions.map((session) => ({
          sessionId: session.sessionId,
          title: session.title,
          status: recordingDisplayStatus(
            session.status,
            session.episodeId === null ? null : episodeStatuses.get(session.episodeId),
          ),
          createdAt: session.createdAt.toISOString(),
          episodeId: session.episodeId,
        }))}
      />
    </div>
  );
}
