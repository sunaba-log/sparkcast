"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Download, Loader2, XCircle } from "lucide-react";
import type { RecordingSessionView } from "@/lib/recording/types";
import { RecordingStatusBadge } from "@/components/recording/RecordingStatusBadge";

const EPISODE_STATUS_LABELS: Record<string, string> = {
  upload_pending: "ミックス待ち",
  uploaded: "処理待ち",
  processing: "文字起こし・議事録を作成中",
  completed: "完了",
  failed: "失敗",
};

// 収録後の処理状況（ミックス → 既存パイプライン）。完了したらエピソードへ案内する。
export function PostRecordingPanel({ sessionId }: { sessionId: string }) {
  const [view, setView] = useState<RecordingSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const response = await fetch(`/api/recording/sessions/${sessionId}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const next = (await response.json()) as RecordingSessionView;
        if (cancelled) return;
        setView(next);
        setError(null);
        const finished =
          next.status === "failed" ||
          next.status === "expired" ||
          next.episodeStatus === "completed" ||
          next.episodeStatus === "failed";
        if (!finished) timer = setTimeout(load, 4000);
      } catch {
        if (cancelled) return;
        setError("状況を取得できませんでした。再試行しています…");
        timer = setTimeout(load, 8000);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  if (!view) {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-gray-600">
        <Loader2 className="w-4 h-4 animate-spin" /> 読み込んでいます…
      </p>
    );
  }

  const failed = view.status === "failed" || view.episodeStatus === "failed";
  const completed = view.episodeStatus === "completed";
  const names = new Map(view.participants.map((participant) => [participant.participantId, participant.displayName]));
  const downloads = view.tracks.filter((track) => track.kind === "local" && track.downloadable);

  return (
    <div className="space-y-4">
      <div className="border border-brand/20 rounded-xs bg-white/60 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <RecordingStatusBadge status={view.status} />
          {view.episodeStatus && (
            <span className="text-sm text-gray-700">
              エピソード: {EPISODE_STATUS_LABELS[view.episodeStatus] ?? view.episodeStatus}
            </span>
          )}
        </div>

        {failed ? (
          <p className="inline-flex items-start gap-1.5 text-sm text-red-700">
            <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
            処理に失敗しました。{view.error ?? view.episodeError ?? ""}
          </p>
        ) : completed ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-green-700">
            <CheckCircle2 className="w-4 h-4" /> エピソードができました。
          </p>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-sm text-gray-700">
            <Loader2 className="w-4 h-4 animate-spin" />
            {view.status === "mixing"
              ? "話者ごとの録音を揃えてミックスしています。数分かかります。"
              : "エピソードを作成しています。"}
          </p>
        )}

        {view.episodeId !== null && (
          <Link
            href={`/episodes/${view.episodeId}`}
            className="inline-block text-sm text-brand underline underline-offset-2"
          >
            エピソードを開く
          </Link>
        )}
        {error && <p className="text-xs text-yellow-700">{error}</p>}
      </div>

      {downloads.length > 0 && (
        <div className="border border-brand/20 rounded-xs bg-white/60 p-4 space-y-2">
          <p className="text-sm font-medium text-gray-700">話者別の録音（編集用・30 日で削除されます）</p>
          <ul className="space-y-1">
            {downloads.map((track) => (
              <li key={track.participantId}>
                <a
                  href={`/api/recording/sessions/${sessionId}/tracks/${track.participantId}`}
                  className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline"
                >
                  <Download className="w-4 h-4" />
                  {names.get(track.participantId) ?? "参加者"}.flac
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
