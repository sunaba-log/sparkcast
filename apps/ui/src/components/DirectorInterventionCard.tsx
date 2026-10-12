"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, CirclePlay, Play } from "lucide-react";
import {
  createTrackRecorder,
  type TrackRecorder,
} from "@/lib/recording/recorder";
import type {
  DirectorIntervention,
  ReplacementAudioAsset,
} from "@/types/episode";

const severityStyles: Record<DirectorIntervention["severity"], string> = {
  1: "bg-gray-100 text-gray-700",
  2: "bg-blue-100 text-blue-800",
  3: "bg-amber-100 text-amber-800",
  4: "bg-red-100 text-red-700",
  5: "bg-red-100 text-red-700",
};

const labels = {
  insert: "訂正を挿入",
  cut: "カット",
  silence: "無音化",
  replace: "代替音声で置換",
};
const actionButton =
  "rounded border border-gray-300 px-2 py-1 text-xs disabled:opacity-40";

function pauseOtherAudio(event: React.SyntheticEvent<HTMLAudioElement>) {
  document.querySelectorAll("audio").forEach((audio) => {
    if (audio !== event.currentTarget) audio.pause();
  });
}

export function formatDirectorTimestamp(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const minutes = Math.floor(milliseconds / 60_000);
  const remainingSeconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = String(milliseconds % 1000).padStart(3, "0");
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}.${remainder}`;
}

export function formatFullTimestamp(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const remainingSeconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = String(milliseconds % 1000).padStart(3, "0");
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}.${remainder}`;
}

export function DirectorInterventionCard({
  episodeId,
  intervention,
  defaultExpanded = false,
  disabled,
  canSeek,
  onChange,
  onSeek,
  onPlayRange,
}: {
  episodeId?: string;
  intervention: DirectorIntervention;
  defaultExpanded?: boolean;
  disabled: boolean;
  canSeek: boolean;
  onChange: (change: Partial<Pick<DirectorIntervention, "correctionScript" | "status" | "action" | "start" | "end" | "assetId">>) => void;
  onSeek: (seconds: number) => void;
  onPlayRange?: (start: number, end: number) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [kind, setKind] = useState<"synthesize" | "recording">("synthesize");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [asset, setAsset] = useState<ReplacementAudioAsset | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [message, setMessage] = useState("");
  const recorder = useRef<TrackRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const chunks = useRef<Blob[]>([]);
  const generation = useRef(0);

  const currentAction = intervention.action ?? "insert";
  const start = intervention.start ?? Math.max(0, intervention.insertAt - 2);
  const end = intervention.end ?? intervention.insertAt;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      void recorder.current?.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!episodeId || !intervention.assetId) return;
    let cancelled = false;
    fetch(
      `/api/episodes/${episodeId}/policy-audio?assetId=${intervention.assetId}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (!cancelled) {
          setAsset(body.asset);
          setKind(body.asset.kind === "recorded" ? "recording" : "synthesize");
          setAudioUrl(body.url);
        }
      })
      .catch((error) => {
        if (!cancelled) setMessage(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [episodeId, intervention.assetId]);

  async function media(
    operation: "synthesize" | "recording" | "preview",
    blob?: Blob,
  ) {
    if (!episodeId) return;
    const currentGeneration = ++generation.current;
    setBusy(true);
    setMessage("");
    try {
      let audioBase64: string | undefined;
      if (blob)
        audioBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      const response = await fetch(`/api/episodes/${episodeId}/policy-audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation,
          proposalId: intervention.id,
          script: intervention.correctionScript,
          audioBase64,
          action: currentAction,
          start,
          end,
          assetId: intervention.assetId,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "音声を準備できませんでした");
      if (!mounted.current || currentGeneration !== generation.current) return;
      if (operation === "preview") {
        setPreviewUrl(body.url);
      } else {
        setAsset(body.asset);
        setAudioUrl(body.url);
        onChange({ assetId: body.asset.id });
      }
    } catch (error) {
      if (mounted.current)
        setMessage(
          error instanceof Error ? error.message : "音声処理に失敗しました",
        );
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  async function stopRecording() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    try {
      await recorder.current?.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      setRecording(false);
      if (chunks.current.length !== 1)
        throw new Error(
          "録音が空か長すぎます。120秒以内で録り直してください。",
        );
      await media("recording", chunks.current[0]);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "録音を停止できませんでした",
      );
    } finally {
      recorder.current = null;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      setRecording(false);
    }
  }

  async function startRecording() {
    document.querySelectorAll("audio").forEach((audio) => audio.pause());
    setBusy(true);
    setMessage("");
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (!mounted.current) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = acquired;
      chunks.current = [];
      recorder.current = createTrackRecorder({
        track: acquired.getAudioTracks()[0],
        serverNow: () => Date.now(),
        forceWav: true,
        timesliceMs: 130_000,
        onChunk: (chunk) => chunks.current.push(chunk.blob),
      });
      await recorder.current.start();
      setRecording(true);
      setBusy(false);
      setPreviewUrl("");
      onChange({ assetId: null });
      timer.current = setTimeout(() => void stopRecording(), 119_000);
    } catch (error) {
      stream.current?.getTracks().forEach((track) => track.stop());
      await recorder.current?.stop();
      setMessage(
        error instanceof Error ? error.message : "マイクを利用できません",
      );
      setBusy(false);
    }
  }

  const locked = disabled || busy || recording || intervention.status === "rejected";

  return (
    <article className="rounded-xs border border-gray-200 bg-white transition-colors">
      <div
        className="flex items-center gap-2.5 p-3.5 cursor-pointer hover:bg-gray-50/60 transition-colors select-none"
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <ChevronDown
          className={`w-4 h-4 text-gray-700 shrink-0 transition-transform duration-200 ${
            isExpanded ? "rotate-180" : ""
          }`}
        />
        <button
          type="button"
          disabled={disabled || !canSeek}
          onClick={(event) => {
            event.stopPropagation();
            if (onPlayRange) onPlayRange(start, end);
            else onSeek(start);
          }}
          className="font-mono text-xs font-semibold text-brand hover:underline disabled:cursor-default disabled:no-underline"
        >
          {formatFullTimestamp(start)} - {formatFullTimestamp(end)}
        </button>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${severityStyles[intervention.severity]}`}>
          深刻度{intervention.severity}/5
        </span>
        <span className="rounded-full bg-gray-200/80 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          {intervention.category}
        </span>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          {labels[currentAction]}
        </span>
        {intervention.status === "approved" && (
          <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
            承認済
          </span>
        )}
        {intervention.status === "rejected" && (
          <span className="ml-auto rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
            却下済
          </span>
        )}
      </div>
      {isExpanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-100">
          <div>
            <p className="text-xs font-bold text-gray-900 mb-1">
              {intervention.speaker || "話者"}の発話
            </p>
            <p className="text-xs text-gray-800 leading-relaxed">
              「{intervention.sourceText}」
            </p>
          </div>
          {(intervention.reason || intervention.referenceUrl) && (
            <div className="rounded-xs border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-950 space-y-1">
              {intervention.reason && (
                <div>
                  <span className="font-semibold text-blue-900">判断根拠: </span>
                  <span className="leading-relaxed">{intervention.reason}</span>
                </div>
              )}
              {intervention.referenceUrl && (
                <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
                  <span className="font-semibold text-blue-900">参照リンク: </span>
                  <a
                    href={intervention.referenceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand font-medium hover:underline inline-flex items-center gap-0.5 break-all"
                  >
                    {intervention.referenceUrl}
                    <span aria-hidden="true" className="text-[10px]">↗</span>
                  </a>
                </div>
              )}
            </div>
          )}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs">
                開始（秒）
                <input
                  aria-label="編集開始秒"
                  type="number"
                  min="0"
                  step="0.001"
                  value={start}
                  disabled={locked}
                  onChange={(event) => {
                    generation.current++;
                    setPreviewUrl("");
                    onChange({ start: Number(event.target.value) });
                  }}
                  className="ml-1 w-24 border p-1"
                />
              </label>
              <label className="text-xs">
                終了（秒）
                <input
                  aria-label="編集終了秒"
                  type="number"
                  min="0"
                  step="0.001"
                  value={end}
                  disabled={locked}
                  onChange={(event) => {
                    generation.current++;
                    setPreviewUrl("");
                    onChange({ end: Number(event.target.value) });
                  }}
                  className="ml-1 w-24 border p-1"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`${actionButton} inline-flex items-center justify-center p-1.5 cursor-pointer disabled:cursor-not-allowed`}
                disabled={!canSeek || !onPlayRange || start >= end}
                onClick={() => onPlayRange?.(start, end)}
                title="対象範囲を再生"
                aria-label="対象範囲を再生"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
              </button>
              <button
                type="button"
                className={`${actionButton} inline-flex items-center justify-center p-1.5 cursor-pointer disabled:cursor-not-allowed`}
                disabled={!canSeek || !onPlayRange}
                onClick={() =>
                  onPlayRange?.(Math.max(0, start - 2), end + 2)
                }
                title="前後を含めて再生"
                aria-label="前後を含めて再生"
              >
                <CirclePlay className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(labels) as Array<keyof typeof labels>).map((action) => (
              <button
                key={action}
                type="button"
                className={`${actionButton} ${
                  currentAction === action
                    ? "bg-brand text-white border-brand"
                    : "bg-white hover:bg-gray-50 text-gray-700"
                }`}
                aria-pressed={currentAction === action}
                disabled={locked}
                onClick={() => {
                  generation.current++;
                  setPreviewUrl("");
                  onChange({ action });
                }}
              >
                {labels[action]}
              </button>
            ))}
          </div>
          {(currentAction === "insert" || currentAction === "replace") && (
            <div className="space-y-2">
              <p className="text-xs text-gray-600">
                {currentAction === "insert"
                  ? `対象発話（${formatDirectorTimestamp(start)}〜${formatDirectorTimestamp(end)}）の直後に台詞を割り込み挿入します。`
                  : `対象発話（${formatDirectorTimestamp(start)}〜${formatDirectorTimestamp(end)}）を台詞音声で置き換えます。`}
              </p>
              <div>
                <label
                  className="block text-xs font-bold text-gray-900 mb-1"
                  htmlFor={`correction-${intervention.id}`}
                >
                  {currentAction === "insert" ? "AIディレクターの台詞提案" : "代替台詞"}
                </label>
                <textarea
                  id={`correction-${intervention.id}`}
                  aria-label={currentAction === "insert" ? "AIディレクターの台詞提案" : "代替台詞"}
                  rows={2}
                  disabled={locked}
                  value={intervention.correctionScript}
                  onChange={(event) => {
                    generation.current++;
                    setPreviewUrl("");
                    setAudioUrl("");
                    setAsset(null);
                    onChange({ correctionScript: event.target.value, assetId: null });
                  }}
                  className="w-full rounded-xs border border-brand/60 px-3 py-2 text-xs leading-relaxed text-gray-900 disabled:bg-gray-100 focus:outline-none focus:border-brand"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`${actionButton} ${kind === "synthesize" ? "bg-brand text-white border-brand" : ""}`}
                  aria-pressed={kind === "synthesize"}
                  disabled={locked}
                  onClick={() => {
                    setKind("synthesize");
                    setAudioUrl("");
                    setAsset(null);
                    setPreviewUrl("");
                    onChange({ assetId: null });
                  }}
                >
                  合成音声
                </button>
                <button
                  type="button"
                  className={`${actionButton} ${kind === "recording" ? "bg-brand text-white border-brand" : ""}`}
                  aria-pressed={kind === "recording"}
                  disabled={locked}
                  onClick={() => {
                    setKind("recording");
                    setAudioUrl("");
                    setAsset(null);
                    setPreviewUrl("");
                    onChange({ assetId: null });
                  }}
                >
                  ブラウザ録音
                </button>
              </div>
              {kind === "synthesize" ? (
                <button
                  type="button"
                  className={actionButton}
                  disabled={locked || !intervention.correctionScript.trim()}
                  onClick={() => media("synthesize")}
                >
                  台詞から音声を生成
                </button>
              ) : recording ? (
                <button
                  type="button"
                  className={actionButton}
                  onClick={stopRecording}
                >
                  録音を停止・検証
                </button>
              ) : (
                <button
                  type="button"
                  className={actionButton}
                  disabled={locked || !intervention.correctionScript.trim()}
                  onClick={startRecording}
                >
                  録音する／取り直す
                </button>
              )}
              {audioUrl && intervention.assetId && (
                <div className="text-xs space-y-1">
                  <p className="text-gray-700">
                    {currentAction === "insert" ? "挿入する音声" : "置換する音声"}（
                    {asset?.kind === "recorded" ? "録音" : "合成音声"}・
                    {((asset?.durationMs ?? 0) / 1000).toFixed(2)}秒）
                  </p>
                  <audio controls src={audioUrl} onPlay={pauseOtherAudio} />
                  {asset?.transcript && (
                    <p className="text-gray-600">確認された発話：{asset.transcript}</p>
                  )}
                </div>
              )}
            </div>
          )}
          {currentAction === "cut" && (
            <p className="text-xs text-gray-600">
              対象発話（{formatDirectorTimestamp(start)}〜{formatDirectorTimestamp(end)}）を音声から削除します。
            </p>
          )}
          {currentAction === "silence" && (
            <p className="text-xs text-gray-600">
              対象発話（{formatDirectorTimestamp(start)}〜{formatDirectorTimestamp(end)}）を無音化します。
            </p>
          )}
          {episodeId && (
            <div>
              <button
                type="button"
                className={actionButton}
                disabled={
                  locked ||
                  ((currentAction === "replace" || currentAction === "insert") &&
                    !intervention.assetId) ||
                  (currentAction !== "insert" && start >= end)
                }
                onClick={() => media("preview")}
              >
                編集後の前後を確認
              </button>
              {previewUrl && (
                <div className="mt-2 text-xs space-y-1">
                  <p className="text-gray-700">プレビュー音声:</p>
                  <audio
                    aria-label="編集プレビュー"
                    controls
                    src={previewUrl}
                    onPlay={pauseOtherAudio}
                  />
                </div>
              )}
            </div>
          )}
          {(busy || recording) && (
            <p className="text-xs text-gray-500">
              {recording
                ? "録音中（最大120秒）…"
                : "音声を処理・検証しています…"}
            </p>
          )}
          {message && (
            <p role="alert" className="text-xs text-red-600">
              {message}
            </p>
          )}
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              disabled={locked}
              onClick={() => onChange({ status: "approved" })}
              aria-pressed={intervention.status === "approved"}
              className={`min-h-[36px] px-5 py-2 rounded-xs text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center ${
                intervention.status === "approved"
                  ? "bg-emerald-700 text-white ring-2 ring-emerald-600 ring-offset-1"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
              }`}
            >
              承認
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => onChange({ status: "rejected" })}
              aria-pressed={intervention.status === "rejected"}
              className={`min-h-[36px] px-5 py-2 rounded-xs text-xs font-medium transition-colors cursor-pointer flex items-center justify-center ${
                intervention.status === "rejected"
                  ? "bg-gray-600 text-white border border-gray-600"
                  : "bg-white hover:bg-gray-50 border border-gray-300 text-gray-700"
              }`}
            >
              却下
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
