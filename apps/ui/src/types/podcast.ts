export type PodcastRole = "owner" | "editor";

export type AudioAuditPolicy = {
  version: string;
  enabled: boolean;
  confidentialTerms: string[];
  allowedTerms: string[];
};

export type PodcastSummary = {
  id: number;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  rssFeedPath: string | null;
  role: PodcastRole;
};
