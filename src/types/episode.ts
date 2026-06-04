export type EpisodeStatus = "uploaded" | "processing" | "completed" | "failed";

export type Episode = {
  id: string;
  title: string;
  createdAt: string;
  status: EpisodeStatus;
  audioFileName: string;
  minutesGenerated: boolean;
  xPostsGenerated: boolean;
  seedsGenerated: boolean;
  minutes: string;
  xPostRecommendations: string[];
  conversationSeeds: string[];
};
