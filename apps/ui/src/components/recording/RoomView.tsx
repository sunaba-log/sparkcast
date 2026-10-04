"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Copy,
  Loader2,
  LogOut,
  Mic,
  MicOff,
  Square,
  UserX,
  Volume2,
  WifiOff,
} from "lucide-react";
import type { RecordingController } from "@/lib/recording/controller";
import type { ParticipantView } from "@/lib/recording/protocol";
import type { RecordingSessionView } from "@/lib/recording/types";
import { LevelBar } from "@/components/recording/LevelBar";

const ENDED_MESSAGES = {
  kicked: "ホストによってルームから退出しました。",
  closed: "収録は終了しました。ご参加ありがとうございました。",
  replaced: "別のタブ（または端末）で入室したため、この画面は切断されました。",
  unauthorized: "認証の期限が切れました。ページを再読み込みしてください。",
  full: "ルームが満員のため入室できませんでした。",
} as const;

// 6 分超えなら「1:02:03」、未満は「05:03」
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

async function hostAction(sessionId: string, path: string, body: unknown = {}) {
  const response = await fetch(`/api/recording/sessions/${sessionId}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "操作に失敗しました");
  return payload;
}

export function RoomView({
  controller,
  sessionId,
  initialView,
  onFinalized,
}: {
  controller: RecordingController;
  sessionId: string;
  initialView: RecordingSessionView | null;
  onFinalized: () => void;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { room, self } = snapshot;
  const isHost = self.role === "host";
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  // 開始・停止・退出・エピソード化の二度押しを止める（state の反映を待たずに効く）
  const runningRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  if (snapshot.ended) {
    return (
      <div className="border border-brand/20 rounded-xs bg-white/60 p-6 text-center space-y-2">
        <p className="text-gray-800">{ENDED_MESSAGES[snapshot.ended]}</p>
        {snapshot.upload.pending > 0 && snapshot.ended !== "kicked" && (
          <p className="text-sm text-yellow-700">
            未送信の録音が {snapshot.upload.pending} 件あります。このページを開いたままにすると送信を続けます。
          </p>
        )}
      </div>
    );
  }

  const status = room?.status ?? "idle";
  const serverNow = now + (snapshot.clock.offsetMs ?? 0);
  const elapsed =
    room?.startedAtMs != null ? (room.stoppedAtMs ?? (status === "recording" ? serverNow : room.startedAtMs)) - room.startedAtMs : 0;
  const participants = room?.participants ?? [];
  const others = participants.filter((participant) => participant.pid !== self.pid);
  const everyoneFlushed = participants
    .filter((participant) => participant.connected || participant.pendingChunks > 0)
    .every((participant) => participant.flushed);
  const stoppedForMs = room?.stoppedAtMs ? serverNow - room.stoppedAtMs : 0;
  const inviteUrl = initialView ? `${window.location.origin}${initialView.invitePath}` : null;

  async function run(action: () => Promise<unknown>) {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "操作に失敗しました");
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 状態とタイマー */}
      <div className="flex flex-wrap items-center gap-3 border border-brand/20 rounded-xs bg-white/60 px-4 py-3">
        {status === "recording" ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-red-600">
            <CircleDot className="w-4 h-4 animate-pulse" /> 収録中
          </span>
        ) : status === "stopped" ? (
          <span className="text-sm font-bold text-gray-700">収録終了</span>
        ) : (
          <span className="text-sm font-bold text-gray-700">待機中</span>
        )}
        <span className="font-mono text-lg tabular-nums text-gray-900">{formatElapsed(elapsed)}</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-gray-500">
          {snapshot.connection !== "open" && (
            <span className="inline-flex items-center gap-1 text-yellow-700">
              <WifiOff className="w-3.5 h-3.5" /> 再接続中…
            </span>
          )}
          {snapshot.call === "connected" ? "通話: 接続" : `通話: ${snapshot.call === "new" ? "準備中" : snapshot.call}`}
        </span>
      </div>

      {status === "recording" && (
        <div className="flex gap-2 rounded-xs border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p>収録中は画面を閉じたり、他のアプリに切り替えたりしないでください。録音が途切れることがあります。</p>
        </div>
      )}

      {snapshot.audioBlocked && (
        <button
          type="button"
          onClick={() => void controller.unlockAudio()}
          className="w-full inline-flex items-center justify-center gap-2 py-2 text-sm border border-brand text-brand rounded-xs bg-white hover:bg-brand-light"
        >
          <Volume2 className="w-4 h-4" /> 相手の声を聞くにはここを押してください
        </button>
      )}

      {/* 招待 URL（ホスト） */}
      {isHost && inviteUrl && status !== "stopped" && (
        <div className="border border-brand/20 rounded-xs bg-white/60 p-3 space-y-2">
          <p className="text-sm font-medium text-gray-700">招待 URL（ゲストに送ってください）</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={inviteUrl}
              className="flex-1 min-w-0 border border-gray-300 rounded-xs px-2 py-1.5 text-base sm:text-xs bg-white text-gray-600"
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(inviteUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="inline-flex items-center gap-1 px-3 text-xs border border-brand text-brand rounded-xs hover:bg-brand-light whitespace-nowrap"
            >
              <Copy className="w-3.5 h-3.5" /> {copied ? "コピー済み" : "コピー"}
            </button>
          </div>
        </div>
      )}

      {/* 参加者 */}
      <ul className="border border-brand/20 rounded-xs bg-white/60 divide-y divide-brand/10">
        {participants.map((participant) => (
          <ParticipantRow
            key={participant.pid}
            participant={participant}
            isSelf={participant.pid === self.pid}
            level={snapshot.levels[participant.pid] ?? 0}
            showUpload={status !== "idle"}
            canKick={isHost && participant.pid !== self.pid && participant.role === "guest"}
            onKick={() =>
              void run(() => hostAction(sessionId, "kick", { participantId: participant.pid }))
            }
          />
        ))}
        {participants.length === 0 && <li className="px-4 py-3 text-sm text-gray-500">接続しています…</li>}
      </ul>

      {/* 自分の操作 */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => controller.setMuted(!snapshot.muted)}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-xs border ${snapshot.muted ? "border-red-500 text-red-600 bg-red-50" : "border-gray-300 text-gray-700 bg-white"}`}
          aria-pressed={snapshot.muted}
        >
          {snapshot.muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          {snapshot.muted ? "ミュート中" : "ミュート"}
        </button>

        {isHost && status === "idle" && (
          <button
            type="button"
            disabled={busy || others.length === 0}
            onClick={() => void run(() => hostAction(sessionId, "control", { action: "start" }))}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xs bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
            title={others.length === 0 ? "ゲストが入室すると開始できます" : undefined}
          >
            <CircleDot className="w-4 h-4" /> 収録を開始
          </button>
        )}
        {isHost && status === "recording" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm("収録を停止しますか？停止すると再開はできません。")) {
                void run(() => hostAction(sessionId, "control", { action: "stop" }));
              }
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xs bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40"
          >
            <Square className="w-4 h-4" /> 収録を停止
          </button>
        )}
        {!isHost && status !== "recording" && (
          <button
            type="button"
            onClick={() => void controller.leave().then(() => window.location.reload())}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-xs border border-gray-300 text-gray-700 bg-white ml-auto"
          >
            <LogOut className="w-4 h-4" /> 退出
          </button>
        )}
      </div>

      {isHost && status === "idle" && others.length === 0 && (
        <p className="text-xs text-gray-500">ゲストが入室すると「収録を開始」が押せます。</p>
      )}

      {/* 収録後 */}
      {status === "stopped" && (
        <div className="border border-brand/20 rounded-xs bg-white/60 p-4 space-y-3">
          {isHost ? (
            <>
              <p className="text-sm text-gray-800">
                {everyoneFlushed
                  ? "全員の録音が届きました。エピソード化できます。"
                  : "各自の端末から録音を送っています。全員分が届くまでお待ちください。"}
              </p>
              {!everyoneFlushed && (
                <p className="text-xs text-gray-500">
                  送信が終わらない参加者がいても、ホストが録っていた予備の音声で補えます（音質は下がります）。
                </p>
              )}
              <button
                type="button"
                disabled={busy || (!everyoneFlushed && stoppedForMs < 60_000) || snapshot.upload.pending > 0}
                onClick={() =>
                  void run(async () => {
                    await hostAction(sessionId, "finalize");
                    onFinalized();
                  })
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xs bg-brand text-white hover:bg-brand-hover disabled:opacity-40"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {everyoneFlushed ? "エピソード化する" : "待たずにエピソード化する"}
              </button>
              {!everyoneFlushed && stoppedForMs < 60_000 && (
                <p className="text-xs text-gray-500">停止から 1 分経つと、待たずに進められます。</p>
              )}
            </>
          ) : snapshot.flushed ? (
            <p className="inline-flex items-center gap-1.5 text-sm text-green-700">
              <CheckCircle2 className="w-4 h-4" /> 録音の送信が終わりました。このページを閉じても大丈夫です。
            </p>
          ) : (
            <p className="inline-flex items-center gap-1.5 text-sm text-gray-800">
              <Loader2 className="w-4 h-4 animate-spin" /> 録音を送信しています（残り {snapshot.upload.pending} 件）。このページを閉じないでください。
            </p>
          )}
        </div>
      )}

      {(actionError || snapshot.error) && (
        <p className="text-sm text-red-600">{actionError ?? snapshot.error}</p>
      )}

      {!snapshot.persistentStorage && (
        <p className="text-xs text-gray-500">
          このブラウザでは録音を端末に一時保存できないため、送信前にページを閉じると録音が失われます。
        </p>
      )}
    </div>
  );
}

function ParticipantRow({
  participant,
  isSelf,
  level,
  showUpload,
  canKick,
  onKick,
}: {
  participant: ParticipantView;
  isSelf: boolean;
  level: number;
  showUpload: boolean;
  canKick: boolean;
  onKick: () => void;
}) {
  const micLabel =
    participant.mic === "muted"
      ? "ミュート"
      : participant.mic === "interrupted"
        ? "マイクが一時停止"
        : participant.mic === "ended"
          ? "マイクが切断"
          : null;
  return (
    <li className="px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${participant.connected ? "bg-green-500" : "bg-gray-300"}`}
            title={participant.connected ? "接続中" : "切断"}
          />
          <span className="text-sm font-medium text-gray-900 truncate min-w-0" title={participant.name}>
            {participant.name}
          </span>
          {/* 名前が長くて省略されても「自分」が分かるよう、名前の外に置く */}
          {isSelf && <span className="text-xs text-gray-500 shrink-0">（あなた）</span>}
          {participant.role === "host" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-light text-brand shrink-0">ホスト</span>
          )}
          {micLabel && <span className="text-xs text-yellow-700 shrink-0">{micLabel}</span>}
          {!participant.connected && <span className="text-xs text-gray-500 shrink-0">切断中</span>}
        </div>
        <LevelBar level={participant.connected ? level : 0} compact label={`${participant.name} の音量`} />
        {showUpload && (
          <p className="text-[11px] text-gray-500">
            {participant.recorder === "recording" ? "録音中 · " : participant.recorder === "error" ? "録音エラー · " : ""}
            送信済み {participant.uploadedChunks} 件（{formatBytes(participant.uploadedBytes)}）
            {participant.pendingChunks > 0 && ` · 未送信 ${participant.pendingChunks} 件`}
            {participant.flushed && " · 送信完了"}
          </p>
        )}
      </div>
      {canKick && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`${participant.name} さんを退出させますか？`)) onKick();
          }}
          className="p-1.5 text-gray-400 hover:text-red-600"
          title="退出させる"
        >
          <UserX className="w-4 h-4" />
        </button>
      )}
    </li>
  );
}
