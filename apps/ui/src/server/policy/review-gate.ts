import "server-only";
import {
  listDirectorInterventions,
  listPolicyFindings,
  markEpisodeAwaitingPublishConfirmation,
} from "@/server/episodes/data-repository";

// 承認・却下・原音声公開の条件を、どの API 経路（統合レビュー・訂正介入・旧判断・原音声公開）でも同じにする。
// 「要確認事項（音声校正の指摘・訂正介入）が 1 件でも未判断なら公開へ進めない」
// 「原音声の公開は、すべての要確認事項が却下されている（または要確認事項が無い）ときだけ」
export async function reviewDecisionState(podcastId: number, episodeId: number) {
  const [findings, interventions] = await Promise.all([
    listPolicyFindings(podcastId, episodeId),
    listDirectorInterventions(podcastId, episodeId),
  ]);
  const items = [...findings, ...interventions];
  return {
    findings,
    interventions,
    hasItems: items.length > 0,
    undecided: items.some((item) => item.status === "pending"),
    allRejected: items.every((item) => item.status === "rejected"),
  };
}

/** すべての要確認事項が却下済みなら、原音声公開の確認待ちへ移す。移した場合 true。 */
export async function moveToPublishConfirmationIfAllRejected(
  podcastId: number,
  episodeId: number,
): Promise<boolean> {
  const state = await reviewDecisionState(podcastId, episodeId);
  if (!state.hasItems || state.undecided || !state.allRejected) return false;
  return markEpisodeAwaitingPublishConfirmation(podcastId, episodeId);
}

/** 原音声を公開してよいか（未判断・承認済みの要確認事項が無い）。 */
export async function canPublishOriginal(
  podcastId: number,
  episodeId: number,
): Promise<boolean> {
  const state = await reviewDecisionState(podcastId, episodeId);
  return !state.undecided && state.allRejected;
}
