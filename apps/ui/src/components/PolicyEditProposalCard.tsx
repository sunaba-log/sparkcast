"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Mic, Play, Sparkles, Square, Tally1, Tally2 } from "lucide-react";



import { formatDirectorTimestamp } from "@/components/DirectorInterventionCard";
import {
  createTrackRecorder,
  type TrackRecorder,
} from "@/lib/recording/recorder";
import type {
  PolicyEditProposal,
  ReplacementAudioAsset,
} from "@/types/episode";

const labels = {
  cut: "カット",
  silence: "無音化",
  replace: "代替音声による置換",
};
const categories = {
  pii: "PII",
  confidential_information: "機密情報",
  third_party_risk: "第三者リスク",
};
const button =
  "rounded border border-gray-300 px-2 py-1 text-xs disabled:opacity-40";

function FindingText({
  finding,
}: {
  finding: PolicyEditProposal["findings"][number];
}) {
  const chars = Array.from(finding.text);
  const start = finding.evidenceStart;
  const end = finding.evidenceEnd;
  if (
    start === undefined ||
    start === null ||
    end === undefined ||
    end === null
  )
    return <p>{finding.text}</p>;
  return (
    <p>
      {chars.slice(0, start).join("")}
      <mark>{chars.slice(start, end).join("")}</mark>
      {chars.slice(end).join("")}
    </p>
  );
}
function pauseOtherAudio(event: React.SyntheticEvent<HTMLAudioElement>) {
  document.querySelectorAll("audio").forEach((audio) => {
    if (audio !== event.currentTarget) audio.pause();
  });
}
export function PolicyEditProposalCard({
  proposal,
  episodeId,
  version,
  disabled,
  canSeek,
  onSeek,
  onPlayRange,
  onChange,
  onBusy,
}: {
  proposal: PolicyEditProposal;
  episodeId: string;
  version: number;
  disabled: boolean;
  canSeek: boolean;
  onSeek: (seconds: number) => void;
  onPlayRange?: (start: number, end: number) => void;
  onChange: (proposal: PolicyEditProposal) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
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
    if (!proposal.assetId) return;
    let cancelled = false;
    fetch(
      `/api/episodes/${episodeId}/policy-audio?assetId=${proposal.assetId}`,
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
  }, [episodeId, proposal.assetId]);
  function change(values: Partial<PolicyEditProposal>) {
    generation.current++;
    setPreviewUrl("");
    if ("script" in values) {
      setAudioUrl("");
      setAsset(null);
      values.assetId = null;
    }
    onChange({ ...proposal, ...values, status: "pending" });
  }
  async function media(
    operation: "synthesize" | "recording" | "preview",
    blob?: Blob,
  ) {
    const currentGeneration = ++generation.current;
    setBusy(true);
    onBusy(true);
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
          version,
          proposalId: proposal.id,
          script: proposal.script,
          audioBase64,
          action: proposal.action,
          start: proposal.start,
          end: proposal.end,
          assetId: proposal.assetId,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "音声を準備できませんでした");
      if (!mounted.current || currentGeneration !== generation.current) return;
      if (operation === "preview") setPreviewUrl(body.url);
      else {
        setAsset(body.asset);
        setAudioUrl(body.url);
        onChange({ ...proposal, assetId: body.asset.id, status: "pending" });
      }
    } catch (error) {
      if (mounted.current)
        setMessage(
          error instanceof Error ? error.message : "音声処理に失敗しました",
        );
    } finally {
      if (mounted.current) {
        setBusy(false);
        onBusy(false);
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
      onBusy(false);
    }
  }
  async function startRecording() {
    document.querySelectorAll("audio").forEach((audio) => audio.pause());
    onBusy(true);
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
      onChange({ ...proposal, assetId: null, status: "pending" });
      timer.current = setTimeout(() => void stopRecording(), 119_000);
    } catch (error) {
      stream.current?.getTracks().forEach((track) => track.stop());
      await recorder.current?.stop();
      setMessage(
        error instanceof Error ? error.message : "マイクを利用できません",
      );
      setBusy(false);
      onBusy(false);
    }
  }
  const locked = disabled || busy || recording;
  const ready =
    proposal.rangeConfirmed &&
    proposal.start < proposal.end &&
    (proposal.action !== "replace" ||
      Boolean(proposal.assetId && proposal.script.trim()));
  return (
    <article className="rounded-xs border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <button
          aria-expanded={expanded}
          aria-label="編集案の詳細"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown className={`w-4 h-4 ${expanded ? "rotate-180" : ""}`} />
        </button>
        <button
          type="button"
          disabled={disabled || !canSeek}
          onClick={(event) => {
            event.stopPropagation();
            if (onPlayRange) onPlayRange(proposal.start, proposal.end);
            else onSeek(proposal.start);
          }}
          className="font-mono text-xs font-semibold text-brand hover:underline disabled:cursor-default disabled:no-underline"
        >
          {formatDirectorTimestamp(proposal.start)} - {formatDirectorTimestamp(proposal.end)}
        </button>
        {[...new Set(proposal.findings.map((finding) => finding.category))].map(
          (category) => (
            <span
              key={category}
              className="rounded-full bg-amber-100 px-2 text-xs"
            >
              {categories[category]}
            </span>
          ),
        )}
        <span className="text-xs text-gray-600">
          {proposal.findings.length}件の根拠
        </span>
        <span className="ml-auto text-xs">
          {proposal.status === "approved"
            ? `承認済：${labels[proposal.action]}`
            : proposal.status === "rejected"
              ? "却下済"
              : "未判断"}
        </span>
      </div>
      {expanded && (
        <div className="space-y-3 border-t p-4">
          {proposal.findings.map((finding) => (
            <div key={finding.id} className="text-xs">
              <p className="font-semibold">
                {categories[finding.category]}・{finding.source}{" "}
                {finding.entityType}
              </p>
              <FindingText finding={finding} />
            </div>
          ))}
          <div className="rounded-xs border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-950 space-y-1">
            <div>
              <span className="font-semibold text-blue-900">推奨: </span>
              <span className="leading-relaxed">
                {labels[proposal.recommendedAction]} — {proposal.reason}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs">
                開始（秒）
                <input
                  aria-label="編集開始秒"
                  type="number"
                  min="0"
                  step="0.001"
                  value={proposal.start}
                  disabled={locked}
                  onChange={(event) =>
                    change({
                      start: Number(event.target.value),
                      rangeConfirmed: false,
                    })
                  }
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
                  value={proposal.end}
                  disabled={locked}
                  onChange={(event) =>
                    change({
                      end: Number(event.target.value),
                      rangeConfirmed: false,
                    })
                  }
                  className="ml-1 w-24 border p-1"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`${button} inline-flex items-center justify-center p-1.5 cursor-pointer disabled:cursor-not-allowed`}
                disabled={
                  !canSeek || !onPlayRange || proposal.start >= proposal.end
                }
                onClick={() => onPlayRange?.(proposal.start, proposal.end)}
                title="対象範囲を再生"
                aria-label="対象範囲を再生"
              >
                <Tally1 className="w-3.5 h-3.5" />
                <Play className="w-3.5 h-3.5 fill-current" />
                <Tally1 className="w-3.5 h-3.5 rotate-180" />
              </button>
              <button
                type="button"
                className={`${button} inline-flex items-center justify-center p-1.5 cursor-pointer disabled:cursor-not-allowed`}
                disabled={!canSeek || !onPlayRange}
                onClick={() =>
                  onPlayRange?.(Math.max(0, proposal.start - 2), proposal.end + 2)
                }
                title="前後を含めて再生"
                aria-label="前後を含めて再生"
              >
                <Tally2 className="w-3.5 h-3.5" />
                <Play className="w-3.5 h-3.5 " />
                <Tally2 className="w-3.5 h-3.5 rotate-180" />
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-600">
            {proposal.rangePrecision === "chunk"
              ? "チャンク単位の暫定範囲です。試聴して対象を調整してください。"
              : "単語時刻から推定した範囲です。語頭・語尾を試聴して確認してください。"}{" "}
            ミックス音声の範囲全体に適用されます。
          </p>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={proposal.rangeConfirmed}
              disabled={locked}
              onChange={(event) =>
                change({ rangeConfirmed: event.target.checked })
              }
            />
            対象範囲を確認した
          </label>
          <div className="inline-flex w-full sm:w-auto p-0.5 rounded-xs bg-gray-100 border border-gray-200 text-xs">
            {(Object.keys(labels) as Array<keyof typeof labels>).map(
              (action) => {
                const isSelected = proposal.action === action;
                return (
                  <button
                    key={action}
                    type="button"
                    className={`flex-1 sm:flex-initial px-3 py-1.5 font-medium transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 rounded-xs text-xs ${isSelected
                      ? "bg-brand text-white shadow-xs font-semibold"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/60"
                      }`}
                    aria-pressed={isSelected}
                    disabled={locked}
                    onClick={() => change({ action })}
                  >
                    {labels[action]}
                  </button>
                );
              },
            )}
          </div>
          {proposal.action === "replace" && (
            <div className="space-y-2">
              <label className="block text-xs font-semibold">
                AIディレクターの台詞提案
                <textarea
                  aria-label="代替台詞"
                  className="mt-1 block w-full rounded border p-2 text-xs font-normal"
                  value={proposal.script}
                  disabled={locked}
                  onChange={(event) => change({ script: event.target.value })}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex w-full sm:w-auto p-0.5 rounded-xs bg-gray-100 border border-gray-200 text-xs">
                  <button
                    type="button"
                    className={`flex-1 sm:flex-initial px-3 py-1.5 font-medium transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 rounded-xs text-xs ${kind === "synthesize"
                      ? "bg-brand text-white shadow-xs font-semibold"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/60"
                      }`}
                    aria-pressed={kind === "synthesize"}
                    disabled={locked}
                    onClick={() => {
                      setKind("synthesize");
                      setAudioUrl("");
                      setAsset(null);
                      change({ assetId: null });
                    }}
                  >
                    合成音声
                  </button>
                  <button
                    type="button"
                    className={`flex-1 sm:flex-initial px-3 py-1.5 font-medium transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 rounded-xs text-xs ${kind === "recording"
                      ? "bg-brand text-white shadow-xs font-semibold"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/60"
                      }`}
                    aria-pressed={kind === "recording"}
                    disabled={locked}
                    onClick={() => {
                      setKind("recording");
                      setAudioUrl("");
                      setAsset(null);
                      change({ assetId: null });
                    }}
                  >
                    ブラウザ録音
                  </button>
                </div>
                {kind === "synthesize" ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xs border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 shadow-xs transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={locked || !proposal.script.trim()}
                    onClick={() => media("synthesize")}
                  >
                    <Sparkles className="w-3.5 h-3.5 text-brand" />
                    台詞から音声を生成
                  </button>
                ) : recording ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xs bg-red-600 hover:bg-red-700 text-white shadow-xs transition-colors cursor-pointer"
                    onClick={stopRecording}
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    録音を停止・検証
                  </button>
                ) : (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xs border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 shadow-xs transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={locked || !proposal.script.trim()}
                    onClick={startRecording}
                  >
                    <Mic className="w-3.5 h-3.5 text-red-600" />
                    録音する／取り直す
                  </button>
                )}
              </div>
              {audioUrl && proposal.assetId && (
                <div className="text-xs">
                  <p>
                    挿入する音声（
                    {asset?.kind === "recorded" ? "録音" : "合成音声"}・
                    {((asset?.durationMs ?? 0) / 1000).toFixed(2)}秒）
                  </p>
                  <audio controls src={audioUrl} onPlay={pauseOtherAudio} />
                  <p>確認された発話：{asset?.transcript}</p>
                </div>
              )}
            </div>
          )}
          <div>
            <button
              className={button}
              disabled={
                locked || (proposal.action === "replace" && !proposal.assetId)
              }
              onClick={() => media("preview")}
            >
              編集後の前後を確認
            </button>
          </div>
          {previewUrl && (
            <audio
              aria-label="編集プレビュー"
              controls
              src={previewUrl}
              onPlay={pauseOtherAudio}
            />
          )}
          {(busy || recording) && (
            <p className="text-xs">
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
          <div className="flex justify-end gap-2">
            <button
              className={`${button} bg-emerald-700 text-white`}
              disabled={locked || !ready}
              onClick={() => onChange({ ...proposal, status: "approved" })}
            >
              この編集案を承認
            </button>
            <button
              className={button}
              disabled={locked}
              onClick={() => onChange({ ...proposal, status: "rejected" })}
            >
              却下
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
