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
}: {
  intervention: DirectorIntervention;
  defaultExpanded?: boolean;
  disabled: boolean;
  canSeek: boolean;
  onChange: (change: Partial<Pick<DirectorIntervention, "correctionScript" | "status">>) => void;
  onSeek: (seconds: number) => void;
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
            onSeek(intervention.insertAt);
          }}
          className="font-mono text-xs font-semibold text-brand hover:underline disabled:cursor-default disabled:no-underline"
        >
          {formatFullTimestamp(intervention.insertAt)}
        </button>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${severityStyles[intervention.severity]}`}>
          深刻度{intervention.severity}/5
        </span>
        <span className="rounded-full bg-gray-200/80 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          {intervention.category}
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
