import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH, DELETE } from "@/app/api/episodes/[id]/route";

vi.mock("@/server/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ uid: "user-1" }),
}));

vi.mock("@/server/podcasts/selection", () => ({
  requireSelectedPodcastForApi: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/server/episodes/data-repository", () => ({
  findEpisode: vi.fn().mockResolvedValue({ id: "42", podcastId: 1, title: "Episode 42", status: "completed" }),
  listDirectorInterventions: vi.fn().mockResolvedValue([]),
  listPolicyFindings: vi.fn().mockResolvedValue([]),
  updateEpisodeGeneratedContent: vi.fn().mockResolvedValue(undefined),
  updateEpisodeMetadata: vi.fn().mockResolvedValue(true),
  setEpisodePublished: vi.fn().mockResolvedValue(true),
  deleteEpisodeRecord: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/server/episodes/automator-jobs", () => ({
  runAutomatorJob: vi.fn().mockResolvedValue({ executionName: "exec-1" }),
}));

describe("api/episodes/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PATCH updates isPublished and triggers sync_rss", async () => {
    const { setEpisodePublished } = await import("@/server/episodes/data-repository");
    const { runAutomatorJob } = await import("@/server/episodes/automator-jobs");

    const request = new Request("http://localhost/api/episodes/42", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublished: true }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(200);
    expect(setEpisodePublished).toHaveBeenCalledWith(1, 42, true);
    expect(runAutomatorJob).toHaveBeenCalledWith({ action: "sync_rss", podcastId: 1 });
  });

  it("does not publish while an audio policy finding remains pending", async () => {
    const { listPolicyFindings, setEpisodePublished } = await import("@/server/episodes/data-repository");
    vi.mocked(listPolicyFindings).mockResolvedValueOnce([
      { id: "finding-1", status: "pending" },
    ] as never);
    const request = new Request("http://localhost/api/episodes/42", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublished: true }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: "42" }) });

    expect(response.status).toBe(409);
    expect(setEpisodePublished).not.toHaveBeenCalled();
  });

  it("DELETE deletes episode and triggers sync_rss", async () => {
    const { deleteEpisodeRecord } = await import("@/server/episodes/data-repository");
    const { runAutomatorJob } = await import("@/server/episodes/automator-jobs");

    const request = new Request("http://localhost/api/episodes/42", {
      method: "DELETE",
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(200);
    expect(deleteEpisodeRecord).toHaveBeenCalledWith(1, 42);
    expect(runAutomatorJob).toHaveBeenCalledWith({ action: "sync_rss", podcastId: 1 });
  });
});
