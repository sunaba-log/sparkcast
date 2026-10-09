"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
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

export function PolicyFindingCard({
  finding,
  defaultExpanded = false,
  disabled,
  canSeek,
  onSeek,
  onChangeStatus,
}: {
  finding: PolicyFinding;
  defaultExpanded?: boolean;
  disabled: boolean;
  canSeek: boolean;
  onSeek: (seconds: number) => void;
  onChangeStatus: (status: PolicyFindingStatus) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

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
            onSeek(finding.start);
          }}
          className="font-mono text-xs font-semibold text-brand hover:underline disabled:cursor-default disabled:no-underline"
        >
          {formatDirectorTimestamp(finding.start)} - {formatDirectorTimestamp(finding.end)}
        </button>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            finding.category === "pii"
              ? "bg-amber-100 text-amber-800"
              : finding.category === "confidential_information"
                ? "bg-orange-100 text-orange-800"
                : "bg-purple-100 text-purple-800"
          }`}
        >
          {categoryLabels[finding.category]}
        </span>
        <span className="rounded-full bg-gray-200/80 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          {finding.entityType ?? finding.source}
        </span>
        {finding.status === "approved" && (
          <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
            無音化
          </span>
        )}
        {finding.status === "rejected" && (
          <span className="ml-auto rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
            却下済
          </span>
        )}
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-100">
          <div>
            <p className="text-xs font-bold text-gray-900 mb-1">検知された発話</p>
            <p className="text-sm text-gray-800 leading-relaxed">{finding.text}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-900 mb-1">AIディレクターの台詞提案</p>
            <div className="w-full rounded-xs border border-brand/60 bg-gray-50/50 px-3 py-2 text-sm leading-relaxed text-gray-900">
              {finding.text}
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChangeStatus("approved")}
              aria-pressed={finding.status === "approved"}
              className={`min-h-[36px] px-5 py-2 rounded-xs text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center ${
                finding.status === "approved"
                  ? "bg-emerald-700 text-white ring-2 ring-emerald-600 ring-offset-1"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
              }`}
            >
              無音化
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChangeStatus("rejected")}
              aria-pressed={finding.status === "rejected"}
              className={`min-h-[36px] px-5 py-2 rounded-xs text-xs font-medium transition-colors cursor-pointer flex items-center justify-center ${
                finding.status === "rejected"
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
    <section className="space-y-4 border-t border-brand/20 pt-5" aria-label="ポリシー監査">
      <div>
        <h3 className="text-base font-bold text-gray-900">ポリシー監査</h3>
        <p className="mt-1 text-xs text-gray-600">
          検知項目ごとに判断してください。承認した項目は `silence` 編集用の新規レンディションへ反映されます。
        </p>
      </div>
      <div className="space-y-3">
        {state.findings.map((finding) => (
          <PolicyFindingCard
            key={finding.id}
            finding={finding}
            disabled={!editable || saving}
            canSeek={canSeek}
            onSeek={onSeek}
            onChangeStatus={(status) => changeStatus(finding.id, status)}
          />
        ))}
      </div>
      {message && <p className={`text-sm ${message.includes("できません") || message.includes("してください") ? "text-red-600" : "text-emerald-700"}`}>{message}</p>}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        {editable && (
          <button
            type="button"
            disabled={saving || !allDecided}
            onClick={review}
            className="rounded-xs bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {saving ? "判断を保存中…" : "すべての判断を確定"}
          </button>
        )}
        {episodeStatus === "awaiting_approval" && allDecided && hasApproved && (
          <button
            type="button"
            disabled={saving}
            onClick={startEditing}
            className="rounded-xs bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            承認した内容で音声編集を開始
          </button>
        )}
        {episodeStatus === "awaiting_publish_confirmation" && (
          <button
            type="button"
            disabled={saving}
            onClick={confirmOriginalPublication}
            className="rounded-xs bg-orange-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            原音声を公開する
          </button>
        )}
      </div>
    </section>
  );
}
