"use client";

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
    }
  | {
      mode: "guest";
      sessionId: string;
      title: string | null;
      initialName: string;
      realtimeBaseUrl: string;
      inviteKey: string;
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
  const [stage, setStage] = useState<"prejoin" | "room" | "post">(() =>
    props.mode === "host" && !props.canEnterRoom
      ? "post"
      : "prejoin",
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
      <header className="mb-5">
        <p className="text-xs font-bold text-brand tracking-wide">収録ルーム</p>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 break-words">{props.title || "収録"}</h1>
      </header>

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
