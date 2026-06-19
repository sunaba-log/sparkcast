import { Episode } from "@/types/episode";
import { getDefaultPodcastId } from "@/server/env";
import { findEpisode, listEpisodes } from "@/server/episodes/data-repository";

export async function getEpisodes(): Promise<Episode[]> {
  return listEpisodes(getDefaultPodcastId());
}

export async function getEpisodeById(id: string): Promise<Episode | null> {
  const episodeId = Number(id);
  if (!Number.isInteger(episodeId) || episodeId <= 0) return null;
  return findEpisode(getDefaultPodcastId(), episodeId);
}
