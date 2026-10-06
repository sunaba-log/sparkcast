"use client";

import type { DirectorIntervention, DirectorInterventionStatus } from "@/types/episode";

const severityStyles: Record<DirectorIntervention["severity"], string> = {
  1: "bg-gray-100 text-gray-700",
  2: "bg-blue-100 text-blue-800",
  3: "bg-amber-100 text-amber-800",
  4: "bg-orange-100 text-orange-800",
  5: "bg-red-100 text-red-800",
};

export function formatDirectorTimestamp(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const minutes = Math.floor(milliseconds / 60_000);
  const remainingSeconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = String(milliseconds % 1000).padStart(3, "0");
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}.${remainder}`;
}

export function DirectorInterventionCard({
  intervention,
  disabled,
  canSeek,
  onChange,
  onSeek,
}: {
  intervention: DirectorIntervention;
  disabled: boolean;
  canSeek: boolean;
  onChange: (change: Partial<Pick<DirectorIntervention, "correctionScript" | "status">>) => void;
  onSeek: (seconds: number) => void;
}) {
  return (
    <article className="space-y-3 rounded-xs border border-brand/40 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          disabled={disabled || !canSeek}
          onClick={() => onSeek(intervention.insertAt)}
          className="font-mono font-semibold text-brand hover:underline disabled:cursor-default disabled:no-underline"
        >
          {formatDirectorTimestamp(intervention.insertAt)}
        </button>
        <span className={`rounded-full px-2 py-0.5 font-semibold ${severityStyles[intervention.severity]}`}>
          深刻度 {intervention.severity}/5
        </span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">
          {intervention.category}
        </span>
      </div>
      <div className="rounded-xs bg-gray-50 p-3 text-sm leading-relaxed text-gray-800">
        <p className="mb-1 text-xs font-semibold text-gray-500">{intervention.speaker || "不明"}の発話</p>
        <p>{intervention.sourceText}</p>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-700" htmlFor={`correction-${intervention.id}`}>
          AIディレクターの訂正台詞
        </label>
        <textarea
          id={`correction-${intervention.id}`}
          rows={3}
          disabled={disabled || intervention.status === "rejected"}
          value={intervention.correctionScript}
          onChange={(event) => onChange({ correctionScript: event.target.value })}
          className="w-full rounded-xs border border-brand/40 px-3 py-2 text-sm leading-relaxed text-gray-900 disabled:bg-gray-100"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ status: "approved" })}
          aria-pressed={intervention.status === "approved"}
          className={`rounded-xs px-3 py-1.5 text-xs font-semibold ${intervention.status === "approved" ? "bg-emerald-600 text-white" : "border border-emerald-600 text-emerald-700"}`}
        >
          承認
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ status: "rejected" })}
          aria-pressed={intervention.status === "rejected"}
          className={`rounded-xs px-3 py-1.5 text-xs font-semibold ${intervention.status === "rejected" ? "bg-gray-600 text-white" : "border border-gray-400 text-gray-700"}`}
        >
          スキップ / 却下
        </button>
      </div>
    </article>
  );
}
