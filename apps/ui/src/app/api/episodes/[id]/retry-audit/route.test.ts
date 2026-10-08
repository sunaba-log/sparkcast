import { describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/episodes/[id]/retry-audit/route";

vi.mock("@/server/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ uid: "user-1" }),
}));

vi.mock("@/server/podcasts/selection", () => ({
  requireSelectedPodcastForApi: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/server/episodes/data-repository", () => ({
  findEpisode: vi.fn().mockResolvedValue({
    id: "42",
    podcastId: 1,
    title: "Episode 42",
    audioFileName: "audio.mp3",
  }),
  markEpisodeAuditing: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/server/db", () => ({
  getDbPool: vi.fn().mockResolvedValue({
    query: vi.fn().mockResolvedValue({
      rows: [{ source_audio_path: "podcasts/1/episodes/42/source/audio.mp3" }],
    }),
  }),
}));

vi.mock("@/server/episodes/automator-jobs", () => ({
  runAutomatorJob: vi.fn().mockResolvedValue({ executionName: "exec-retry" }),
}));

describe("api/episodes/[id]/retry-audit", () => {
  it("marks episode auditing and triggers automator job with resumeFromAudit", async () => {
    const { markEpisodeAuditing } = await import("@/server/episodes/data-repository");
    const { runAutomatorJob } = await import("@/server/episodes/automator-jobs");

    const request = new Request("http://localhost/api/episodes/42/retry-audit", {
      method: "POST",
    });

    const response = await POST(request, { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(200);
    expect(markEpisodeAuditing).toHaveBeenCalledWith(1, 42);
    expect(runAutomatorJob).toHaveBeenCalledWith({
      gcsTriggerObjectName: "podcasts/1/episodes/42/source/audio.mp3",
      resumeFromAudit: true,
      podcastId: 1,
    });
  });

  it("returns 500 when automator job execution is skipped", async () => {
    const { runAutomatorJob } = await import("@/server/episodes/automator-jobs");
    vi.mocked(runAutomatorJob).mockResolvedValueOnce({
      executionName: null,
      skipped: true,
    });

    const request = new Request("http://localhost/api/episodes/42/retry-audit", {
      method: "POST",
    });

    const response = await POST(request, { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("AUTOMATOR_JOB_NAME");
  });

  it("returns 500 when automator job throws an error", async () => {
    const { runAutomatorJob } = await import("@/server/episodes/automator-jobs");
    vi.mocked(runAutomatorJob).mockRejectedValueOnce(new Error("Cloud Run error"));

    const request = new Request("http://localhost/api/episodes/42/retry-audit", {
      method: "POST",
    });

    const response = await POST(request, { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("再開に失敗しました");
  });
});
