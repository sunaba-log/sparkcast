import { describe, expect, it, vi } from "vitest";
import { createPodcast } from "@/server/podcasts/data-repository";
import { getDbPool } from "@/server/db";
import { runAutomatorJob } from "@/server/episodes/automator-jobs";

vi.mock("@/server/db", () => ({
  getDbPool: vi.fn(),
}));

vi.mock("@/server/episodes/automator-jobs", () => ({
  runAutomatorJob: vi.fn().mockResolvedValue({ executionName: "exec-sync" }),
}));

describe("podcasts data-repository createPodcast", () => {
  it("initializes rss_feed_path and triggers sync_rss automator job", async () => {
    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    mockClient.query.mockImplementation((sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT") {
        return Promise.resolve();
      }
      if (sql.includes("INSERT INTO podcasts")) {
        return Promise.resolve({
          rows: [
            {
              podcast_id: 10,
              title: "New Podcast",
              description: "New Desc",
              cover_image_url: "/images/default-podcast-cover.png",
              rss_feed_path: null,
            },
          ],
        });
      }
      if (sql.includes("UPDATE podcasts\n       SET rss_feed_path = $1")) {
        return Promise.resolve({ rowCount: 1 });
      }
      if (sql.includes("INSERT INTO podcast_ownerships")) {
        return Promise.resolve({ rowCount: 1 });
      }
      return Promise.resolve({ rows: [] });
    });

    vi.mocked(getDbPool).mockResolvedValue({
      connect: vi.fn().mockResolvedValue(mockClient),
    } as never);

    const podcast = await createPodcast({
      title: "New Podcast",
      description: "New Desc",
      ownerUserId: "user-10",
    });

    expect(podcast.id).toBe(10);
    expect(podcast.rssFeedPath).toBe("podcasts/10/feed.xml");
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("SET rss_feed_path = $1"),
      ["podcasts/10/feed.xml", 10],
    );
    expect(runAutomatorJob).toHaveBeenCalledWith({
      action: "sync_rss",
      podcastId: 10,
    });
  });
});
