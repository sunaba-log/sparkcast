import { notFound } from "next/navigation";
import { RecordingSessionList } from "@/components/recording/RecordingSessionList";
import { requireRegisteredUser } from "@/server/auth";
import { getDbPool } from "@/server/db";
import { isRecordingEnabled } from "@/server/env";
import { listRecordingSessions } from "@/server/recording/repository";
import { requireSelectedPodcast } from "@/server/podcasts/selection";

export const dynamic = "force-dynamic";

export default async function RecordPage() {
  if (!isRecordingEnabled()) notFound();
  const user = await requireRegisteredUser();
  const podcastId = await requireSelectedPodcast(user);
  const sessions = await listRecordingSessions(await getDbPool(), podcastId);

  return (
    <div className="max-w-3xl">
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
          status: session.status,
          createdAt: session.createdAt.toISOString(),
          episodeId: session.episodeId,
        }))}
      />
    </div>
  );
}
