import "server-only";
import { getSessionUser } from "@/server/auth";
import { requireSelectedPodcastForApi } from "@/server/podcasts/selection";
import { findEpisode } from "@/server/episodes/data-repository";

export class PolicyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function policyApiContext(id: string, editing = false) {
  const user = await getSessionUser();
  if (!user) throw new PolicyApiError("認証が必要です", 401);
  const podcastId = await requireSelectedPodcastForApi(user);
  const episodeId = Number(id);
  if (!Number.isSafeInteger(episodeId) || episodeId <= 0)
    throw new PolicyApiError("エピソードが見つかりません", 404);
  const episode = await findEpisode(podcastId, episodeId);
  if (!episode) throw new PolicyApiError("エピソードが見つかりません", 404);
  if (editing && episode.status !== "awaiting_approval")
    throw new PolicyApiError("このエピソードは承認待ちではありません", 409);
  return { podcastId, episodeId, user, episode };
}
