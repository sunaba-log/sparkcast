import { describe, expect, it, vi } from "vitest";
import { buildMixerJobOverrides, runMixerJob } from "@/server/recording/jobs";

const input = {
  sessionId: "sid",
  podcastId: 7,
  episodeId: 42,
  objectPath: "podcasts/7/episodes/42/source/recording-sid.flac",
};

describe("mixer job", () => {
  it("passes the session and episode through env overrides", () => {
    expect(buildMixerJobOverrides(input).overrides.containerOverrides[0].env).toEqual([
      { name: "RECORDING_SESSION_ID", value: "sid" },
      { name: "PODCAST_ID", value: "7" },
      { name: "EPISODE_ID", value: "42" },
      { name: "OUTPUT_OBJECT_PATH", value: "podcasts/7/episodes/42/source/recording-sid.flac" },
    ]);
  });

  it("calls the Cloud Run Admin API with a metadata token", async () => {
    const previous = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
    delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok" })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ metadata: { name: "executions/abc" } })),
      );
    const result = await runMixerJob("projects/p/locations/r/jobs/mixer", input, fetchImpl);
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "https://run.googleapis.com/v2/projects/p/locations/r/jobs/mixer:run",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    );
    expect(result.executionName).toBe("executions/abc");
    if (previous) process.env.GOOGLE_OAUTH_ACCESS_TOKEN = previous;
  });
});
