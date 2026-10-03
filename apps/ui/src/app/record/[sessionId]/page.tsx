import { notFound } from "next/navigation";
import { RecordingRoomApp } from "@/components/recording/RecordingRoomApp";
import { hasPodcastAccess, requireRegisteredUser } from "@/server/auth";
import { getDbPool } from "@/server/db";
import { getRealtimeBaseUrl, getRecordingRoomSecret, isRecordingEnabled } from "@/server/env";
import { getRecordingSession } from "@/server/recording/repository";
import { buildSessionView } from "@/server/recording/view";

export const dynamic = "force-dynamic";

export default async function HostRecordingPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  if (!isRecordingEnabled()) notFound();
  const user = await requireRegisteredUser();
  const { sessionId } = await params;
  const pool = await getDbPool();
  const session = await getRecordingSession(pool, sessionId);
  if (!session || !(await hasPodcastAccess(user.uid, session.podcastId))) notFound();
  const view = await buildSessionView(pool, getRecordingRoomSecret(), session);

  return (
    <RecordingRoomApp
      mode="host"
      sessionId={sessionId}
      title={session.title}
      initialName={user.displayName ?? "ホスト"}
      initialView={view}
      realtimeBaseUrl={getRealtimeBaseUrl()}
    />
  );
}
