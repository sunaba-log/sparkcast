export type AudioTimelinePiece = {
  sourceStartMs: number;
  sourceEndMs: number;
  outputStartMs: number;
  outputEndMs: number;
  kind: "original" | "cut" | "silence" | "replace" | "insert";
};
export function mapSourceTime(
  seconds: number,
  timeline: AudioTimelinePiece[],
): number | null {
  if (!timeline.length) return seconds;
  const ms = seconds * 1000;
  const insertion = timeline.find(
    (p) => p.kind === "insert" && p.sourceStartMs === ms,
  );
  if (insertion) return insertion.outputStartMs / 1000;
  const piece = timeline.find(
    (p) => p.sourceStartMs <= ms && ms < p.sourceEndMs,
  );
  if (!piece)
    return timeline.at(-1)?.sourceEndMs === ms
      ? timeline.at(-1)!.outputEndMs / 1000
      : null;
  if (piece.kind === "cut") return null;
  if (piece.kind === "replace") return piece.outputStartMs / 1000;
  return (piece.outputStartMs + ms - piece.sourceStartMs) / 1000;
}
