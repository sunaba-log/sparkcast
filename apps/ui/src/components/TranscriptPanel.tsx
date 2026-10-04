"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatTimestamp } from "@/lib/timestamp";
import type { TranscriptSegment } from "@/types/episode";

// 話者・時刻つきの文字起こし（#166）。時刻を押すとその位置から再生する。
const SPEAKER_COLORS = [
  "text-brand",
  "text-emerald-700",
  "text-orange-700",
  "text-fuchsia-700",
  "text-sky-700",
  "text-rose-700",
];

export function TranscriptPanel({
  episodeId,
  available,
  currentTime,
  canSeek,
  onSeek,
}: {
  episodeId: string;
  available: boolean;
  currentTime: number;
  canSeek: boolean;
  onSeek: (seconds: number) => void;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "loaded"; segments: TranscriptSegment[] }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading" });
    fetch(`/api/episodes/${episodeId}/transcript`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { segments?: TranscriptSegment[]; error?: string };
        if (cancelled) return;
        if (!response.ok) {
          setState({ status: "error", message: body.error ?? "文字起こしを取得できませんでした" });
          return;
        }
        setState({ status: "loaded", segments: body.segments ?? [] });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "通信に失敗しました" });
      });
    return () => {
      cancelled = true;
    };
  }, [episodeId, available]);

  const colors = useMemo(() => {
    const map = new Map<string, string>();
    if (state.status === "loaded") {
      for (const segment of state.segments) {
        const key = segment.speakerId ?? segment.speaker;
        if (!map.has(key)) map.set(key, SPEAKER_COLORS[map.size % SPEAKER_COLORS.length]);
      }
    }
    return map;
  }, [state]);

  if (!available) {
    return (
      <p className="text-sm text-gray-400 italic">
        このエピソードには話者・時刻つきの文字起こしがありません（文字起こしは新しく処理したエピソードから作られます）。
      </p>
    );
  }
  if (state.status === "loading") {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" /> 読み込んでいます…
      </p>
    );
  }
  if (state.status === "error") {
    return <p className="text-sm text-red-600">{state.message}</p>;
  }

  return (
    <ol className="space-y-2 text-sm" aria-label="文字起こし">
      {state.segments.map((segment) => {
        const active = currentTime >= segment.start && currentTime < segment.end;
        return (
          <li
            key={segment.id}
            className={`grid grid-cols-[3.5rem_1fr] gap-x-3 rounded-xs px-2 py-1 ${active ? "bg-brand-light" : ""}`}
          >
            <button
              type="button"
              disabled={!canSeek}
              onClick={() => onSeek(segment.start)}
              className="text-left font-mono text-xs text-gray-500 tabular-nums pt-0.5 hover:text-brand disabled:hover:text-gray-500 disabled:cursor-default"
              title={canSeek ? "この位置から再生" : undefined}
            >
              {formatTimestamp(segment.start)}
            </button>
            <p className="min-w-0 break-words text-gray-800 leading-relaxed">
              <span className={`font-semibold mr-2 ${colors.get(segment.speakerId ?? segment.speaker) ?? ""}`}>
                {segment.speaker || "不明"}
              </span>
              {segment.text}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
