"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { DirectorIntervention } from "@/types/episode";

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
  intervention,
  defaultExpanded = false,
  disabled,
  canSeek,
  onChange,
  onSeek,
  onPlayRange,
}: {
  intervention: DirectorIntervention;
  defaultExpanded?: boolean;
  disabled: boolean;
  canSeek: boolean;
  onChange: (change: Partial<Pick<DirectorIntervention, "correctionScript" | "status" | "action" | "start" | "end">>) => void;
  onSeek: (seconds: number) => void;
  onPlayRange?: (start: number, end: number) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const currentAction = intervention.action ?? "insert";
  const start = intervention.start ?? Math.max(0, intervention.insertAt - 2);
  const end = intervention.end ?? intervention.insertAt;

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
            <p className="text-sm text-gray-800 leading-relaxed">
              {intervention.sourceText}
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
                  disabled={disabled || intervention.status === "rejected"}
                  onChange={(event) =>
                    onChange({ start: Number(event.target.value) })
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
                  value={end}
                  disabled={disabled || intervention.status === "rejected"}
                  onChange={(event) =>
                    onChange({ end: Number(event.target.value) })
                  }
                  className="ml-1 w-24 border p-1"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={actionButton}
                disabled={!canSeek || !onPlayRange || start >= end}
                onClick={() => onPlayRange?.(start, end)}
              >
                対象範囲を再生
              </button>
              <button
                type="button"
                className={actionButton}
                disabled={!canSeek || !onPlayRange}
                onClick={() =>
                  onPlayRange?.(Math.max(0, start - 2), end + 2)
                }
              >
                前後を含めて再生
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
                disabled={disabled || intervention.status === "rejected"}
                onClick={() => onChange({ action })}
              >
                {labels[action]}
              </button>
            ))}
          </div>
          {currentAction === "insert" && (
            <div className="space-y-2">
              <p className="text-xs text-gray-600">
                対象発話（{formatDirectorTimestamp(start)}〜{formatDirectorTimestamp(end)}）の直後に台詞を割り込み挿入します。
              </p>
              <div>
                <label
                  className="block text-xs font-bold text-gray-900 mb-1"
                  htmlFor={`correction-${intervention.id}`}
                >
                  AIディレクターの台詞提案
                </label>
                <textarea
                  id={`correction-${intervention.id}`}
                  rows={2}
                  disabled={disabled || intervention.status === "rejected"}
                  value={intervention.correctionScript}
                  onChange={(event) => onChange({ correctionScript: event.target.value })}
                  className="w-full rounded-xs border border-brand/60 px-3 py-2 text-base md:text-sm leading-relaxed text-gray-900 disabled:bg-gray-100 focus:outline-none focus:border-brand"
                />
              </div>
            </div>
          )}
          {currentAction === "replace" && (
            <div className="space-y-2">
              <p className="text-xs text-gray-600">
                対象発話（{formatDirectorTimestamp(start)}〜{formatDirectorTimestamp(end)}）を台詞音声で置き換えます。
              </p>
              <div>
                <label
                  className="block text-xs font-bold text-gray-900 mb-1"
                  htmlFor={`correction-${intervention.id}`}
                >
                  代替台詞
                </label>
                <textarea
                  id={`correction-${intervention.id}`}
                  rows={2}
                  disabled={disabled || intervention.status === "rejected"}
                  value={intervention.correctionScript}
                  onChange={(event) => onChange({ correctionScript: event.target.value })}
                  className="w-full rounded-xs border border-brand/60 px-3 py-2 text-base md:text-sm leading-relaxed text-gray-900 disabled:bg-gray-100 focus:outline-none focus:border-brand"
                />
              </div>
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
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              disabled={disabled}
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
              disabled={disabled}
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
