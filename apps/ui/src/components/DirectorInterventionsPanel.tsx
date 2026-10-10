"use client";

import { useEffect, useState } from "react";
import type { DirectorIntervention, EpisodeStatus } from "@/types/episode";
import { DirectorInterventionCard } from "@/components/DirectorInterventionCard";

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; interventions: DirectorIntervention[] }
  | { status: "error"; message: string };

function interventionPayload(interventions: DirectorIntervention[]) {
  return interventions.map(({ id, correctionScript, status }) => ({
    id,
    correctionScript,
    status,
  }));
}

export function DirectorInterventionsPanel({
  episodeId,
  episodeStatus,
  canSeek,
  onSeek,
  onEditingStarted,
}: {
  episodeId: string;
  episodeStatus: EpisodeStatus;
  canSeek: boolean;
  onSeek: (seconds: number) => void;
  onEditingStarted: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/episodes/${episodeId}/interventions`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { interventions?: DirectorIntervention[]; error?: string };
        if (cancelled) return;
        if (!response.ok) {
          setState({ status: "error", message: body.error ?? "監査結果を取得できませんでした" });
          return;
        }
        setState({ status: "loaded", interventions: body.interventions ?? [] });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "通信に失敗しました" });
      });
    return () => {
      cancelled = true;
    };
  }, [episodeId]);

  const updateIntervention = (
    id: string,
    change: Partial<Pick<DirectorIntervention, "correctionScript" | "status">>,
  ) => {
    if (state.status !== "loaded") return;
    setState({
      status: "loaded",
      interventions: state.interventions.map((intervention) =>
        intervention.id === id ? { ...intervention, ...change } : intervention,
      ),
    });
  };

  const apply = async () => {
    if (state.status !== "loaded") return;
    setApplying(true);
    setMessage("");
    try {
      const response = await fetch(`/api/episodes/${episodeId}/apply-interventions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interventions: interventionPayload(state.interventions) }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "音声編集を開始できませんでした");
      onEditingStarted();
      setMessage("音声編集を開始しました。完了までこの画面で状態を確認できます。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "音声編集を開始できませんでした");
    } finally {
      setApplying(false);
    }
  };

  if (state.status === "loading") return <p className="text-sm text-gray-500">監査結果を読み込んでいます…</p>;
  if (state.status === "error") return <p className="text-sm text-red-600">{state.message}</p>;
  if (state.interventions.length === 0) return <p className="text-sm text-gray-500">AIディレクターによる訂正提案はありません。</p>;

  const editable = episodeStatus === "awaiting_approval";
  const approvedCount = state.interventions.filter((intervention) => intervention.status === "approved").length;
  return (
    <section className="space-y-4" aria-label="ファクトチェック">
      <div>
        <h3 className="text-base font-bold text-gray-900">ファクトチェック</h3>
        <p className="mt-1 text-xs text-gray-600">
          訂正台詞を確認・編集し、音声へ挿入する提案を承認してください。
        </p>
      </div>
      <div className="space-y-1">
        {state.interventions.map((intervention, index) => (
          <DirectorInterventionCard
            key={intervention.id}
            intervention={intervention}
            defaultExpanded={index === 0}
            disabled={!editable || applying}
            canSeek={canSeek}
            onChange={(change) => updateIntervention(intervention.id, change)}
            onSeek={onSeek}
          />
        ))}
      </div>
      {message && <p className={`text-sm ${message.startsWith("音声編集を開始") ? "text-emerald-700" : "text-red-600"}`}>{message}</p>}
      {editable && (
        <button
          type="button"
          disabled={applying || approvedCount === 0}
          onClick={apply}
          className="rounded-xs bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          {applying ? "音声編集を開始中…" : `承認した内容でカットイン編集を実行 (${approvedCount}件)`}
        </button>
      )}
    </section>
  );
}

export function DirectorInterventionMarkers({
  episodeId,
  duration,
  onSeek,
}: {
  episodeId: string;
  duration: number;
  onSeek: (seconds: number) => void;
}) {
  const [interventions, setInterventions] = useState<DirectorIntervention[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/episodes/${episodeId}/interventions`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { interventions?: DirectorIntervention[] };
        if (!cancelled) setInterventions(body.interventions ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    }
  }, [episodeId]);

  if (!duration) return null;
  return (
    <>
      {interventions
        .filter((intervention) => intervention.status === "approved")
        .map((intervention) => (
          <button
            key={intervention.id}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSeek(intervention.insertAt);
            }}
            title={`訂正予定: ${intervention.insertAt.toFixed(3)}秒`}
            className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded bg-amber-500 hover:bg-amber-600"
            style={{ left: `${Math.min(100, Math.max(0, (intervention.insertAt / duration) * 100))}%` }}
          />
        ))}
    </>
  );
};
