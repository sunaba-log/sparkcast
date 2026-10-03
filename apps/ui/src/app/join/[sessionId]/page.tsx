import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RecordingRoomApp } from "@/components/recording/RecordingRoomApp";
import { getDbPool } from "@/server/db";
import { getRealtimeBaseUrl, getRecordingRoomSecret, isRecordingEnabled } from "@/server/env";
import { getRecordingSession } from "@/server/recording/repository";
import { isJoinable } from "@/server/recording/service";
import { verifyInviteKey } from "@/server/recording/tokens";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "収録ルーム | SparkCast",
  // 招待 URL が検索エンジンや共有プレビューに載らないようにする
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// ゲストの参加ページ（ログイン不要）。招待キーはクエリ k。
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ k?: string }>;
}) {
  if (!isRecordingEnabled()) notFound();
  const [{ sessionId }, { k }] = await Promise.all([params, searchParams]);
  const session = await getRecordingSession(await getDbPool(), sessionId);
  if (!session || !k || !(await verifyInviteKey(sessionId, k, getRecordingRoomSecret()))) {
    return (
      <JoinMessage title="招待 URL が正しくありません">
        URL が途中で切れていないか、ホストに確認してください。
      </JoinMessage>
    );
  }
  if (!isJoinable(session)) {
    return (
      <JoinMessage title="この収録ルームは終了しています">
        新しい招待 URL をホストから受け取ってください。
      </JoinMessage>
    );
  }

  return (
    <RecordingRoomApp
      mode="guest"
      sessionId={sessionId}
      inviteKey={k}
      title={session.title}
      initialName=""
      realtimeBaseUrl={getRealtimeBaseUrl()}
    />
  );
}

function JoinMessage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-md mx-auto mt-16 text-center">
      <h1 className="text-xl font-bold text-gray-900">{title}</h1>
      <p className="mt-3 text-sm text-gray-600">{children}</p>
    </div>
  );
}
