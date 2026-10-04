"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RecordingController } from "@/lib/recording/controller";
import type { JoinResponse, RecordingSessionView } from "@/lib/recording/types";
import { PostRecordingPanel } from "@/components/recording/PostRecordingPanel";
import { PreJoin, type PreJoinResult } from "@/components/recording/PreJoin";
import { RoomView } from "@/components/recording/RoomView";

// 収録ルームの画面全体（#166）。入室前チェック → ルーム → （ホストは）収録後の処理状況。

type Props =
  | {
      mode: "host";
      sessionId: string;
      title: string | null;
      initialName: string;
      realtimeBaseUrl: string;
      initialView: RecordingSessionView;
      // 入室できる（期限内で、終わっていない）か。期限を過ぎた収録は入室せずにエピソード化できる
      canEnterRoom: boolean;
      inviteKey?: undefined;
      acceptsNewGuests?: undefined;
    }
  | {
      mode: "guest";
      sessionId: string;
      title: string | null;
      initialName: string;
      realtimeBaseUrl: string;
      inviteKey: string;
      // 新しいゲストを受け付けるか。収録の停止後は、前に入室した端末だけが（未送信の録音を送るために）入り直せる
      acceptsNewGuests: boolean;
      initialView?: undefined;
      canEnterRoom?: undefined;
    };

type StoredGuest = { participantId: string; rejoinKey: string; displayName: string };

function guestStorageKey(sessionId: string) {
  return `sparkcast-recording:${sessionId}`;
}

function loadGuest(sessionId: string): StoredGuest | null {
  try {
    const raw = localStorage.getItem(guestStorageKey(sessionId));
    return raw ? (JSON.parse(raw) as StoredGuest) : null;
  } catch {
    return null;
  }
}

function saveGuest(sessionId: string, guest: StoredGuest) {
  try {
    localStorage.setItem(guestStorageKey(sessionId), JSON.stringify(guest));
  } catch {
    // 保存できなくても参加はできる（リロード時は新しい参加者になる）
  }
}

async function postJoin(sessionId: string, body: Record<string, unknown>): Promise<JoinResponse> {
  const response = await fetch(`/api/recording/sessions/${sessionId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as JoinResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "入室できませんでした");
  return payload;
}

export function RecordingRoomApp(props: Props) {
  const { sessionId, mode } = props;
  const [stage, setStage] = useState<"checking" | "prejoin" | "room" | "post" | "closed">(() =>
    props.mode === "host"
      ? props.canEnterRoom
        ? "prejoin"
        : "post"
      : // 前に入室した端末かどうかは localStorage を読むまで分からない（読む前にマイクを求めない）
        props.acceptsNewGuests
        ? "prejoin"
        : "checking",
  );
  const [controller, setController] = useState<RecordingController | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialName, setInitialName] = useState(props.initialName);
  const audioContainer = useRef<HTMLDivElement>(null);
  // 入室の二度押しで参加者が 2 人分できないよう、state の反映を待たずに止める
  const joiningRef = useRef(false);

  useEffect(() => {
    if (mode !== "guest") return;
    const stored = loadGuest(sessionId);
    // 保存済みの表示名を入室前の画面に出す（localStorage は描画後にしか読めない）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored?.displayName) setInitialName(stored.displayName);
    setStage((current) => (current === "checking" ? (stored ? "prejoin" : "closed") : current));
  }, [mode, sessionId]);

  const requestJoin = useCallback(
    async (displayName: string): Promise<JoinResponse> => {
      if (props.mode === "host") return postJoin(sessionId, { displayName });
      const stored = loadGuest(sessionId);
      const join = await postJoin(sessionId, {
        inviteKey: props.inviteKey,
        displayName,
        consent: true,
        ...(stored ? { participantId: stored.participantId, rejoinKey: stored.rejoinKey } : {}),
      });
      saveGuest(sessionId, { participantId: join.participantId, rejoinKey: join.rejoinKey, displayName });
      return join;
    },
    [props.mode, props.inviteKey, sessionId],
  );

  async function handleJoin(result: PreJoinResult) {
    if (joiningRef.current) return;
    joiningRef.current = true;
    setJoining(true);
    setError(null);
    try {
      const join = await requestJoin(result.displayName);
      const next = new RecordingController({
        join,
        micTrack: result.track,
        micDeviceId: result.deviceId,
        refreshJoin: () => requestJoin(result.displayName),
        audioContainer: audioContainer.current!,
      });
      await next.start();
      setController(next);
      setStage("room");
    } catch (cause) {
      result.track.stop();
      setError(cause instanceof Error ? cause.message : "入室できませんでした");
    } finally {
      joiningRef.current = false;
      setJoining(false);
    }
  }

  useEffect(() => {
    return () => {
      void controller?.leave();
    };
  }, [controller]);

  return (
    <div className="max-w-3xl mx-auto">
      {mode === "host" && (
        <div className="flex items-center text-xs text-gray-500 gap-2 mb-4">
          <span>ホーム</span>
          <span>&gt;</span>
          <Link href="/record" className="hover:text-brand hover:underline">
            収録
          </Link>
          <span>&gt;</span>
          <span className="font-medium text-gray-800">収録ルーム</span>
        </div>
      )}
      <header className="mb-5">
        {/* ホストはパンくずに「収録ルーム」と出ているので、ゲストにだけ出す */}
        {mode === "guest" && <p className="text-xs font-bold text-brand tracking-wide">収録ルーム</p>}
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 break-words">{props.title || "収録"}</h1>
      </header>

      {stage === "closed" && (
        <div className="border border-brand/20 rounded-xs bg-white/60 p-6 text-center space-y-2">
          <p className="text-gray-800">収録はすでに終了しています。</p>
          <p className="text-sm text-gray-500">新しい招待 URL をホストから受け取ってください。</p>
        </div>
      )}

      {stage === "prejoin" && (
        <PreJoin
          key={initialName}
          mode={mode}
          initialName={initialName}
          realtimeBaseUrl={props.realtimeBaseUrl}
          joining={joining}
          error={error}
          onJoin={handleJoin}
        />
      )}

      {stage === "room" && controller && (
        <RoomView
          controller={controller}
          sessionId={sessionId}
          initialView={props.mode === "host" ? props.initialView : null}
          onFinalized={() => {
            void controller.leave();
            setController(null);
            setStage("post");
          }}
        />
      )}

      {stage === "post" && props.mode === "host" && <PostRecordingPanel sessionId={sessionId} />}

      {/* 相手の声を鳴らす audio 要素の置き場 */}
      <div ref={audioContainer} className="hidden" aria-hidden />
    </div>
  );
}
