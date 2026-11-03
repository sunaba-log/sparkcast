import { describe, expect, it, vi } from "vitest";
import { mapToSNSPostItem, GET } from "./route";
import type { Episode, EpisodePromotion } from "@/types/episode";

vi.mock("@/server/auth", () => ({
  getSessionUser: vi.fn(),
}));

vi.mock("@/server/podcasts/selection", () => ({
  requireSelectedPodcastForApi: vi.fn(),
}));

vi.mock("@/server/episodes/data-repository", () => ({
  listEpisodesAndPromotionsPaginated: vi.fn(),
  updateSnsPromotion: vi.fn(),
  deleteSnsPromotion: vi.fn(),
}));

import { getSessionUser } from "@/server/auth";
import { requireSelectedPodcastForApi } from "@/server/podcasts/selection";
import { listEpisodesAndPromotionsPaginated } from "@/server/episodes/data-repository";

describe("mapToSNSPostItem", () => {
  const dummyEpisode: Episode = {
    id: "10",
    podcastId: 1,
    title: "テストエピソード",
    description: "説明",
    createdAt: "2026-10-01T10:00:00Z",
    status: "completed",
    audioFileName: "test.mp3",
    audioUrl: null,
    artworkUrl: null,
    processingError: null,
    minutesGenerated: true,
    transcriptAvailable: false,
    xPostsGenerated: true,
    seedsGenerated: false,
    minutes: "",
    xPosts: [],
    conversationSeeds: [],
  };

  const dummyPromotion: EpisodePromotion = {
    id: "promo-1",
    message: "テスト本文",
    status: "pending",
    scheduledTime: "2026-10-08T15:30:00Z",
    platformUrls: { apple: "https://apple.com", amazon: "", spotify: "" },
    hashtags: ["#test"],
    generatedAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
  };

  it("maps Episode and EpisodePromotion to SNSPostItem correctly", () => {
    const item = mapToSNSPostItem(dummyEpisode, dummyPromotion);
    expect(item.id).toBe("promo-1");
    expect(item.episodeId).toBe("10");
    expect(item.episodeTitle).toBe("テストエピソード");
    expect(item.status).toBe("pending");
    expect(item.message).toBe("テスト本文");
    expect(item.platformUrls.apple).toBe("https://apple.com");
    expect(item.hashtags).toEqual(["#test"]);

    const expectedDate = new Date("2026-10-08T15:30:00Z");
    expect(item.scheduledDate.yyyy).toBe(String(expectedDate.getFullYear()));
    expect(item.scheduledDate.mm).toBe(String(expectedDate.getMonth() + 1).padStart(2, "0"));
    expect(item.scheduledDate.dd).toBe(String(expectedDate.getDate()).padStart(2, "0"));
  });

  it("falls back to generatedAt or createdAt if scheduledTime is missing", () => {
    const promotionWithoutSchedule: EpisodePromotion = {
      ...dummyPromotion,
      scheduledTime: null,
      generatedAt: "2026-09-20T12:00:00Z",
    };
    const item = mapToSNSPostItem(dummyEpisode, promotionWithoutSchedule);
    const expectedDate = new Date("2026-09-20T12:00:00Z");
    expect(item.scheduledDate.yyyy).toBe(String(expectedDate.getFullYear()));
    expect(item.scheduledDate.mm).toBe(String(expectedDate.getMonth() + 1).padStart(2, "0"));
  });
});

describe("GET /api/sns", () => {
  it("returns posts sorted in descending order of scheduled date", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      uid: "user-1",
      email: "user@example.com",
      displayName: "User",
      registered: true,
      approvalStatus: "active",
      isAdmin: false,
      canRecord: false,
    });
    vi.mocked(requireSelectedPodcastForApi).mockResolvedValue(1);

    const episode1: Episode = {
      id: "1",
      podcastId: 1,
      title: "Episode 1",
      description: "",
      createdAt: "2026-10-01T10:00:00Z",
      status: "completed",
      audioFileName: "",
      audioUrl: null,
      artworkUrl: null,
      processingError: null,
      minutesGenerated: false,
      transcriptAvailable: false,
      xPostsGenerated: true,
      seedsGenerated: false,
      minutes: "",
      xPosts: [
        {
          id: "promo-old",
          message: "Older post",
          status: "posted",
          scheduledTime: "2026-09-10T10:00:00Z",
          platformUrls: { apple: "", amazon: "", spotify: "" },
          hashtags: [],
          generatedAt: "2026-09-10T10:00:00Z",
          updatedAt: "2026-09-10T10:00:00Z",
        },
      ],
      conversationSeeds: [],
    };

    const episode2: Episode = {
      id: "2",
      podcastId: 1,
      title: "Episode 2",
      description: "",
      createdAt: "2026-10-05T10:00:00Z",
      status: "completed",
      audioFileName: "",
      audioUrl: null,
      artworkUrl: null,
      processingError: null,
      minutesGenerated: false,
      transcriptAvailable: false,
      xPostsGenerated: true,
      seedsGenerated: false,
      minutes: "",
      xPosts: [
        {
          id: "promo-newest",
          message: "Newest post",
          status: "pending",
          scheduledTime: "2026-10-08T18:00:00Z",
          platformUrls: { apple: "", amazon: "", spotify: "" },
          hashtags: [],
          generatedAt: "2026-10-08T18:00:00Z",
          updatedAt: "2026-10-08T18:00:00Z",
        },
        {
          id: "promo-middle",
          message: "Middle post",
          status: "pending",
          scheduledTime: "2026-10-02T12:00:00Z",
          platformUrls: { apple: "", amazon: "", spotify: "" },
          hashtags: [],
          generatedAt: "2026-10-02T12:00:00Z",
          updatedAt: "2026-10-02T12:00:00Z",
        },
      ],
      conversationSeeds: [],
    };

    vi.mocked(listEpisodesAndPromotionsPaginated).mockResolvedValue({
      episodes: [episode1, episode2],
      hasMore: false,
    });

    const res = await GET(new Request("http://localhost/api/sns?limit=5&offset=0"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.posts.map((p: { id: string }) => p.id)).toEqual([
      "promo-newest",
      "promo-middle",
      "promo-old",
    ]);
  });
});
