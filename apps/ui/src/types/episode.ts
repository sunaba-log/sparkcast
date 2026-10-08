export type EpisodeStatus =
  | "upload_pending"
  | "uploaded"
  | "processing"
  | "auditing"
  | "awaiting_approval"
  | "editing"
  | "completed"
  | "failed";

export type EpisodePromotion = {
  id: string;
  message: string;
  status: string;
  scheduledTime: string | null;
  platformUrls?: { apple: string; amazon: string; spotify: string };
  hashtags?: string[];
  generatedAt?: string;
  updatedAt?: string;
};

export type Episode = {
  id: string;
  podcastId: number;
  title: string;
  description: string;
  createdAt: string;
  status: EpisodeStatus;
  audioFileName: string;
  audioUrl: string | null;
  artworkUrl: string | null;
  processingError: string | null;
  publishedAt: string | null;
  isPublished: boolean;
  minutesGenerated: boolean;
  // 話者・時刻つきの文字起こしがあるか（#166 以降に処理したエピソード）
  transcriptAvailable: boolean;
  xPostsGenerated: boolean;
  seedsGenerated: boolean;
  minutes: string;
  xPosts: EpisodePromotion[];
  conversationSeeds: string[];
};

export type TopicProposal = {
  id: string;
  podcastId: number;
  targetPeriod: string;
  generatedAt: string;
  relatedNews: Array<{
    title: string;
    url: string;
    summary: string;
    sourceReason: string;
  }>;
  suggestedTopics: Array<{
    title: string;
    description: string;
    suggestedPoints: string[];
    relatedPastEpisodes: number[];
  }>;
};

// 話者・時刻つきの文字起こしの 1 発話（#166）。時刻は音声の先頭からの秒。
export type TranscriptSegment = {
  id: string;
  start: number;
  end: number;
  speaker: string;
  speakerId: string | null;
  text: string;
};

export type DirectorInterventionStatus = "pending" | "approved" | "rejected";

export type DirectorIntervention = {
  id: string;
  insertAt: number;
  sourceText: string;
  speaker: string;
  severity: 1 | 2 | 3 | 4 | 5;
  category: string;
  correctionScript: string;
  status: DirectorInterventionStatus;
};
