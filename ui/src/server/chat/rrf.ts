/** RRF の定数 k。順位差の影響を緩やかにする一般的な既定値。 */
const DEFAULT_RRF_K = 60;

/**
 * 複数のランキングを Reciprocal Rank Fusion（RRF）で融合する（純粋関数）。
 * 各ランキングの順位 rank（0 始まり）に対しスコア 1 / (k + rank + 1) を加算し、
 * 合計スコアの降順で上位 limit 件を返す。同点は先に現れたものを優先する。
 */
export function fuseReciprocalRank<T>(
  rankings: T[][],
  getKey: (item: T) => string,
  limit: number,
  k: number = DEFAULT_RRF_K,
): T[] {
  const fused = new Map<string, { item: T; score: number }>();
  for (const ranking of rankings) {
    ranking.forEach((item, rank) => {
      const key = getKey(item);
      const score = 1 / (k + rank + 1);
      const entry = fused.get(key);
      if (entry) {
        entry.score += score;
      } else {
        fused.set(key, { item, score });
      }
    });
  }
  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}
