import { describe, expect, it, vi } from "vitest";
import {
  buildAutomatorJobOverrides,
  runAutomatorJob,
} from "@/server/episodes/automator-jobs";

describe("automator job overrides", () => {
  it("builds overrides for resume_from_audit", () => {
    const overrides = buildAutomatorJobOverrides({
      gcsTriggerObjectName: "podcasts/1/episodes/2/source/audio.mp3",
      resumeFromAudit: true,
    });
    expect(overrides.overrides.containerOverrides[0].env).toEqual([
      {
        name: "GCS_TRIGGER_OBJECT_NAME",
        value: "podcasts/1/episodes/2/source/audio.mp3",
      },
      { name: "RESUME_FROM_AUDIT", value: "true" },
    ]);
  });

  it("builds overrides for sync_rss", () => {
    const overrides = buildAutomatorJobOverrides({
      action: "sync_rss",
      podcastId: 1,
    });
    expect(overrides.overrides.containerOverrides[0].env).toEqual([
      { name: "ACTION", value: "sync_rss" },
      { name: "PODCAST_ID", value: "1" },
    ]);
  });
});

describe("runAutomatorJob", () => {
  it("skips execution gracefully if AUTOMATOR_JOB_NAME is not set", async () => {
    const prev = process.env.AUTOMATOR_JOB_NAME;
    delete process.env.AUTOMATOR_JOB_NAME;
    const fetchImpl = vi.fn();

    const result = await runAutomatorJob({ action: "sync_rss" }, fetchImpl);
    expect(result.skipped).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();

    if (prev) process.env.AUTOMATOR_JOB_NAME = prev;
  });

  it("calls Cloud Run Admin API when AUTOMATOR_JOB_NAME is set", async () => {
    const prevJob = process.env.AUTOMATOR_JOB_NAME;
    const prevToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
    process.env.AUTOMATOR_JOB_NAME = "projects/p/locations/r/jobs/sparkcast-automator-app-dev";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "test-token";

    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ metadata: { name: "executions/exec-123" } })),
    );

    const result = await runAutomatorJob(
      { action: "sync_rss", podcastId: 2 },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://run.googleapis.com/v2/projects/p/locations/r/jobs/sparkcast-automator-app-dev:run",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
    expect(result.executionName).toBe("executions/exec-123");

    if (prevJob) process.env.AUTOMATOR_JOB_NAME = prevJob;
    else delete process.env.AUTOMATOR_JOB_NAME;
    if (prevToken) process.env.GOOGLE_OAUTH_ACCESS_TOKEN = prevToken;
    else delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  });
});
