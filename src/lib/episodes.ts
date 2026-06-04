import { Episode } from "@/types/episode";
import { mockEpisodes } from "./mockEpisodes";

// These functions are designed to be replaced with Firestore/API calls later.
// The page components should only import from this file, not from mockEpisodes directly.

export async function getEpisodes(): Promise<Episode[]> {
  // TODO: Replace with Firestore query
  return mockEpisodes;
}

export async function getEpisodeById(id: string): Promise<Episode | null> {
  // TODO: Replace with Firestore getDoc
  return mockEpisodes.find((ep) => ep.id === id) ?? null;
}
