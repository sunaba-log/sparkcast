import { Episode } from "@/types/episode";
import { findEpisode, listEpisodes } from "@/server/episodes/data-repository";
import { isLocalUiDemoEnabled } from "@/server/env";
import { mockEpisodes } from "@/lib/mockEpisodes";

export async function getEpisodes(podcastId: number): Promise<Episode[]> {
  if (isLocalUiDemoEnabled()) {
    return mockEpisodes.filter((episode) => episode.podcastId === podcastId);
  }
  return listEpisodes(podcastId);
}

export async function getEpisodeById(
  podcastId: number,
  id: string,
): Promise<Episode | null> {
  if (isLocalUiDemoEnabled()) {
    return mockEpisodes.find(
      (episode) => episode.podcastId === podcastId && episode.id === id,
    ) ?? null;
  }
  const episodeId = Number(id);
  if (!Number.isInteger(episodeId) || episodeId <= 0) return null;
  return findEpisode(podcastId, episodeId);
}
