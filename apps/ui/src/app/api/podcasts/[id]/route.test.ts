import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH, DELETE } from "@/app/api/podcasts/[id]/route";

vi.mock("@/server/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ uid: "user-1" }),
}));

vi.mock("@/server/podcasts/data-repository", () => ({
  isPodcastOwner: vi.fn().mockResolvedValue(true),
  userHasChannelWithTitle: vi.fn().mockResolvedValue(false),
  updatePodcast: vi.fn().mockResolvedValue(undefined),
  deletePodcast: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/podcasts/selection", () => ({
  getSelectedPodcastId: vi.fn().mockResolvedValue(1),
  SELECTED_PODCAST_COOKIE_NAME: "selected_podcast",
}));

describe("api/podcasts/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PATCH updates podcast including audioAuditEnabled", async () => {
    const { updatePodcast } = await import("@/server/podcasts/data-repository");

    const request = new Request("http://localhost/api/podcasts/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "更新後タイトル",
        description: "更新後概要",
        audioAuditEnabled: false,
        confidentialTerms: ["社外秘"],
        allowedTerms: ["公開情報"],
      }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "1" }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ ok: true });
    expect(updatePodcast).toHaveBeenCalledWith({
      podcastId: 1,
      title: "更新後タイトル",
      description: "更新後概要",
      rssFeedPath: undefined,
      castMembers: undefined,
      audioAuditPolicy: {
        enabled: false,
        confidentialTerms: ["社外秘"],
        allowedTerms: ["公開情報"],
      },
    });
  });

  it("PATCH rejects request when user is not authenticated", async () => {
    const { getSessionUser } = await import("@/server/auth");
    vi.mocked(getSessionUser).mockResolvedValueOnce(null);

    const request = new Request("http://localhost/api/podcasts/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "テスト" }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "1" }),
    });

    expect(response.status).toBe(401);
  });

  it("PATCH rejects request when user is not the podcast owner", async () => {
    const { isPodcastOwner } = await import("@/server/podcasts/data-repository");
    vi.mocked(isPodcastOwner).mockResolvedValueOnce(false);

    const request = new Request("http://localhost/api/podcasts/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "テスト" }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "1" }),
    });

    expect(response.status).toBe(403);
  });

  it("DELETE removes podcast successfully", async () => {
    const { deletePodcast } = await import("@/server/podcasts/data-repository");

    const request = new Request("http://localhost/api/podcasts/1", {
      method: "DELETE",
    });

    const response = await DELETE(request, {
      params: Promise.resolve({ id: "1" }),
    });

    expect(response.status).toBe(200);
    expect(deletePodcast).toHaveBeenCalledWith(1);
  });
});
