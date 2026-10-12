"use client";

import { useEffect, useState } from "react";
import { PolicyEditProposalCard } from "@/components/PolicyEditProposalCard";
import type { EpisodeStatus, PolicyReview } from "@/types/episode";

export function PolicyFindingsPanel({
  episodeId,
  episodeStatus,
  canSeek,
  onSeek,
  onPlayRange,
  onStatusChanged,
}: {
  episodeId: string;
  episodeStatus: EpisodeStatus;
  canSeek: boolean;
  onSeek: (seconds: number) => void;
  onPlayRange?: (start: number, end: number) => void;
  onStatusChanged: (status: EpisodeStatus) => void;
}) {
  const [review, setReview] = useState<PolicyReview | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busyCards, setBusyCards] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/episodes/${episodeId}/policy-review`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "音声校正結果を取得できませんでした");
        if (!cancelled) setReview(body);
        if (
          !cancelled &&
          episodeStatus === "awaiting_approval" &&
          body.version === 1 &&
          body.words.length &&
          body.proposals.length
        ) {
          setSaving(true);
          try {
            const suggestion = await fetch(
              `/api/episodes/${episodeId}/policy-review`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  operation: "suggest",
                  version: body.version,
                }),
              },
            );
            const result = await suggestion.json();
            if (!suggestion.ok) throw new Error(result.error);
            if (!cancelled) setReview(result);
          } catch {
            if (!cancelled)
              setMessage(
                "自動提案を完了できませんでした。暫定案の範囲を確認するか、提案を再生成してください。",
              );
          } finally {
            if (!cancelled) setSaving(false);
          }
        }
      })
      .catch((error) => {
        if (!cancelled) setError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [episodeId, episodeStatus]);
  async function request(
    operation: "save" | "suggest" | "apply" | "retry" | "publish",
  ) {
    if (!review) return;
    setSaving(true);
    setMessage("");
    try {
      const path =
        operation === "apply" || operation === "retry"
          ? "apply-interventions"
          : operation === "publish"
            ? "confirm-original-publish"
            : "policy-review";
      const response = await fetch(`/api/episodes/${episodeId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          operation === "retry"
            ? { retryPlanId: review.dispatchRetryPlanId, interventions: [] }
            : operation === "apply"
              ? { planVersion: review.version, interventions: [] }
              : {
                  operation,
                  version: review.version,
                  proposals: review.proposals,
                },
        ),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "処理に失敗しました");
      if (operation === "save" || operation === "suggest") {
        setReview(body);
        setDirty(false);
      }
      if (body.status) onStatusChanged(body.status);
      if (operation === "retry")
        setReview((old) => (old ? { ...old, dispatchRetryPlanId: null } : old));
      setMessage(
        operation === "apply" || operation === "retry"
          ? "確定した編集計画から新しい配信音声を生成しています。"
          : operation === "suggest"
            ? "指摘を統合し、範囲とアクションを提案しました。試聴して確認してください。"
            : "すべての判断を保存しました。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "処理に失敗しました");
    } finally {
      setSaving(false);
    }
  }
  if (error)
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  if (!review)
    return (
      <p className="text-sm text-gray-500">音声校正結果を読み込んでいます…</p>
    );
  if (!review.proposals.length) return null;
  const editable = episodeStatus === "awaiting_approval";
  const locked = saving || busyCards.length > 0;
  const allDecided = review.proposals.every((p) => p.status !== "pending");
  return (
    <section
      className="space-y-1 border-t border-brand/20 pt-5"
      aria-label="ポリシー監査"
    >
      <div>
        <h3 className="text-base font-bold">ポリシー監査</h3>
        <p className="text-xs text-gray-600">
          重複する指摘をまとめて判断します。範囲と音声を確認し、すべての判断を保存してから編集を開始してください。
        </p>
      </div>
      {editable && (
        <button
          className="rounded border px-3 py-2 text-sm disabled:opacity-40"
          disabled={
            locked ||
            dirty ||
            review.proposals.some(
              (p) => p.status !== "pending" || p.assetId !== null,
            )
          }
          onClick={() => request("suggest")}
        >
          指摘を統合してアクション・台詞を提案
        </button>
      )}
      {review.proposals.map((proposal) => (
        <PolicyEditProposalCard
          key={proposal.id}
          proposal={proposal}
          episodeId={episodeId}
          version={review.version}
          disabled={
            !editable ||
            saving ||
            (busyCards.length > 0 && !busyCards.includes(proposal.id))
          }
          canSeek={canSeek}
          onSeek={onSeek}
          onPlayRange={onPlayRange}
          onBusy={(busy) =>
            setBusyCards((ids) =>
              busy
                ? [...new Set([...ids, proposal.id])]
                : ids.filter((id) => id !== proposal.id),
            )
          }
          onChange={(next) => {
            setReview((old) =>
              old
                ? {
                    ...old,
                    proposals: old.proposals.map((p) =>
                      p.id === next.id ? next : p,
                    ),
                  }
                : old,
            );
            setDirty(true);
          }}
        />
      ))}
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
      {dirty && (
        <p className="text-xs text-amber-700">未保存の変更があります。</p>
      )}
      <div className="flex flex-wrap gap-3">
        {episodeStatus === "editing" && review.dispatchRetryPlanId && (
          <button
            type="button"
            disabled={locked}
            onClick={() => request("retry")}
            className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            保存済みの編集要求を再送
          </button>
        )}
        {editable && (
          <button
            type="button"
            disabled={locked || !allDecided}
            onClick={() => request("save")}
            className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            すべての判断を保存
          </button>
        )}
        {editable && (
          <button
            type="button"
            disabled={locked || dirty || !allDecided}
            onClick={() => request("apply")}
            className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            承認した内容で音声編集を開始
          </button>
        )}
        {episodeStatus === "awaiting_publish_confirmation" && (
          <button
            type="button"
            disabled={locked}
            onClick={() => request("publish")}
            className="rounded bg-orange-700 px-4 py-2 text-sm text-white hover:bg-orange-800 disabled:opacity-40 cursor-pointer"
          >
            原音声を公開する
          </button>
        )}
      </div>
    </section>
  );
}
