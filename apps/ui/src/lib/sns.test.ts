import { describe, expect, it } from "vitest";
import {
  mapToSNSPostItem,
  getPostSortTimestamp,
  sortPostsDesc,
  type SNSPostItem,
} from "./sns";
import type { Episode, EpisodePromotion } from "@/types/episode";

describe("src/lib/sns utilities", () => {
  const dummyEpisode: Episode = {
    id: "1",
    podcastId: 1,
    title: "Episode 1",
    description: "",
    createdAt: "2026-10-01T10:00:00Z",
    status: "completed",
    audioFileName: "ep1.mp3",
    audioUrl: null,
    artworkUrl: null,
    processingError: null,
    minutesGenerated: false,
    transcriptAvailable: false,
    xPostsGenerated: true,
    seedsGenerated: false,
    minutes: "",
    xPosts: [],
    conversationSeeds: [],
  };

  const dummyPromo: EpisodePromotion = {
    id: "promo-1",
    message: "Message",
    status: "pending",
    scheduledTime: "2026-10-08T12:00:00Z",
    platformUrls: { apple: "", amazon: "", spotify: "" },
    hashtags: ["#test"],
    generatedAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
  };

  it("mapToSNSPostItem maps episode and promo correctly", () => {
    const item = mapToSNSPostItem(dummyEpisode, dummyPromo);
    expect(item.id).toBe("promo-1");
    expect(item.episodeId).toBe("1");
    expect(item.scheduledDate.yyyy).toBe(String(new Date("2026-10-08T12:00:00Z").getFullYear()));
  });

  it("getPostSortTimestamp returns 0 for undefined/null", () => {
    expect(getPostSortTimestamp(null as unknown as SNSPostItem)).toBe(0);
  });

  it("sortPostsDesc handles empty and non-array safely", () => {
    expect(sortPostsDesc([] as SNSPostItem[])).toEqual([]);
    expect(sortPostsDesc(null as unknown as SNSPostItem[])).toEqual([]);
  });

  it("sortPostsDesc sorts posts descending by scheduled date", () => {
    const p1: SNSPostItem = {
      id: "p1",
      episodeId: "1",
      episodeTitle: "Ep1",
      status: "pending",
      scheduledDate: { yyyy: "2026", mm: "10", dd: "01", hh: "10", min: "00" },
      message: "Old",
      platformUrls: { apple: "", amazon: "", spotify: "" },
      hashtags: [],
      generatedAt: "2026-10-01T10:00:00Z",
      updatedAt: "2026-10-01T10:00:00Z",
    };
    const p2: SNSPostItem = {
      id: "p2",
      episodeId: "2",
      episodeTitle: "Ep2",
      status: "pending",
      scheduledDate: { yyyy: "2026", mm: "10", dd: "08", hh: "18", min: "00" },
      message: "New",
      platformUrls: { apple: "", amazon: "", spotify: "" },
      hashtags: [],
      generatedAt: "2026-10-08T18:00:00Z",
      updatedAt: "2026-10-08T18:00:00Z",
    };
    const sorted = sortPostsDesc([p1, p2]);
    expect(sorted.map((p) => p.id)).toEqual(["p2", "p1"]);
  });
});
