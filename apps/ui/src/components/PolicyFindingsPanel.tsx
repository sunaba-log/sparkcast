"use client";

import { useEffect, useState } from "react";
import type { EpisodeStatus, PolicyFinding, PolicyFindingStatus } from "@/types/episode";
import { formatDirectorTimestamp } from "@/components/DirectorInterventionCard";

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; findings: PolicyFinding[] }
  | { status: "error"; message: string };

const categoryLabels: Record<PolicyFinding["category"], string> = {
  pii: "PII",
  confidential_information: "機密情報",
  third_party_risk: "第三者リスク",
};

export function PolicyFindingsPanel({
  episodeId,
  episodeStatus,
  canSeek,
  onSeek,
  onStatusChanged,
}: {
  episodeId: string;
  episodeStatus: EpisodeStatus;
  canSeek: boolean;
  onSeek: (seconds: number) => void;
  onStatusChanged: (status: EpisodeStatus) => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/episodes/${episodeId}/policy-findings`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { findings?: PolicyFinding[]; error?: string };
        if (cancelled) return;
        if (!response.ok) {
          setState({ status: "error", message: body.error ?? "音声校正結果を取得できませんでした" });
          return;
        }
        setState({ status: "loaded", findings: body.findings ?? [] });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "通信に失敗しました" });
      });
    return () => {
      cancelled = true;
    };
  }, [episodeId]);

  const changeStatus = (id: string, status: PolicyFindingStatus) => {
    if (state.status !== "loaded") return;
    setState({
      status: "loaded",
      findings: state.findings.map((finding) => finding.id === id ? { ...finding, status } : finding),
    });
  };

  const review = async () => {
    if (state.status !== "loaded") return;
    if (state.findings.some((finding) => finding.status === "pending")) {
      setMessage("すべての音声校正項目を承認または却下してください。");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/episodes/${episodeId}/review-policy-findings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          findings: state.findings.map(({ id, status }) => ({ id, status })),
        }),
      });
      const body = (await response.json()) as { status?: EpisodeStatus; error?: string };
      if (!response.ok) throw new Error(body.error ?? "音声校正の判断を保存できませんでした");
      if (body.status) onStatusChanged(body.status);
      setMessage(
        state.findings.some((finding) => finding.status === "approved")
          ? "判断を保存しました。承認済み項目の音声編集を開始できます。"
          : "すべて却下しました。原音声の最終公開確認が必要です。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "音声校正の判断を保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  const startEditing = async () => {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/episodes/${episodeId}/apply-interventions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interventions: [] }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "音声編集を開始できませんでした");
      onStatusChanged("editing");
      setMessage("承認済みの校正内容で新しい音声レンディションを生成しています。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "音声編集を開始できませんでした");
    } finally {
      setSaving(false);
    }
  };

  const confirmOriginalPublication = async () => {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/episodes/${episodeId}/confirm-original-publish`, { method: "POST" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "原音声の公開を開始できませんでした");
      onStatusChanged("processing");
      setMessage("原音声の公開を開始しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "原音声の公開を開始できませんでした");
    } finally {
      setSaving(false);
    }
  };

  if (state.status === "loading") return <p className="text-sm text-gray-500">音声校正結果を読み込んでいます…</p>;
  if (state.status === "error") return <p className="text-sm text-red-600">{state.message}</p>;
  if (state.findings.length === 0) return null;

  const editable = episodeStatus === "awaiting_approval";
  const hasApproved = state.findings.some((finding) => finding.status === "approved");
  const allDecided = state.findings.every((finding) => finding.status !== "pending");
  return (
    <section className="space-y-4 border-t border-brand/20 pt-5" aria-label="音声校正ポリシー監査">
      <div>
        <h3 className="text-sm font-bold text-gray-900">音声校正ポリシー監査</h3>
        <p className="mt-1 text-sm text-gray-600">検知項目ごとに判断してください。承認した項目は `silence` 編集用の新規レンディションへ反映されます。</p>
      </div>
      <div className="space-y-3">
        {state.findings.map((finding) => (
          <article key={finding.id} className="space-y-3 rounded-xs border border-amber-300 p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                disabled={!canSeek}
                onClick={() => onSeek(finding.start)}
                className="font-mono font-semibold text-brand hover:underline disabled:cursor-default disabled:no-underline"
              >
                {formatDirectorTimestamp(finding.start)} - {formatDirectorTimestamp(finding.end)}
              </button>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                {categoryLabels[finding.category]}
              </span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">{finding.entityType ?? finding.source}</span>
            </div>
            <p className="rounded-xs bg-gray-50 p-3 text-sm leading-relaxed text-gray-800">{finding.text}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={!editable || saving}
                onClick={() => changeStatus(finding.id, "approved")}
                aria-pressed={finding.status === "approved"}
                className={`min-h-[44px] rounded-xs px-4 py-2 text-xs font-semibold ${finding.status === "approved" ? "bg-emerald-600 text-white" : "border border-emerald-600 text-emerald-700 hover:bg-emerald-50"}`}
              >
                承認して無音化
              </button>
              <button
                type="button"
                disabled={!editable || saving}
                onClick={() => changeStatus(finding.id, "rejected")}
                aria-pressed={finding.status === "rejected"}
                className={`min-h-[44px] rounded-xs px-4 py-2 text-xs font-semibold ${finding.status === "rejected" ? "bg-gray-600 text-white" : "border border-gray-400 text-gray-700 hover:bg-gray-100"}`}
              >
                却下
              </button>
            </div>
          </article>
        ))}
      </div>
      {message && <p className={`text-sm ${message.includes("できません") || message.includes("してください") ? "text-red-600" : "text-emerald-700"}`}>{message}</p>}
      {editable && (
        <button
          type="button"
          disabled={saving || !allDecided}
          onClick={review}
          className="rounded-xs bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "判断を保存中…" : "すべての判断を確定"}
        </button>
      )}
      {episodeStatus === "awaiting_approval" && allDecided && hasApproved && (
        <button
          type="button"
          disabled={saving}
          onClick={startEditing}
          className="ml-3 rounded-xs bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          承認した内容で音声編集を開始
        </button>
      )}
      {episodeStatus === "awaiting_publish_confirmation" && (
        <button
          type="button"
          disabled={saving}
          onClick={confirmOriginalPublication}
          className="rounded-xs bg-orange-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          原音声を公開する
        </button>
      )}
    </section>
  );
}
