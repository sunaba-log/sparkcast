export function LevelBar({ level, compact = false }: { level: number; compact?: boolean }) {
  const percent = Math.round(Math.max(0, Math.min(1, level)) * 100);
  return (
    <div
      className={`w-full bg-gray-200 rounded-full overflow-hidden ${compact ? "h-1" : "h-2"}`}
      role="meter"
      aria-label="入力レベル"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div
        className={`h-full transition-[width] duration-100 ${percent > 90 ? "bg-red-500" : "bg-brand"}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
