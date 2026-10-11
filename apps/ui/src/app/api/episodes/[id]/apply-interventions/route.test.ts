import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  episode: { status: "awaiting_approval" },
  claim: vi.fn(),
  plan: vi.fn(),
  job: vi.fn(),
  markDispatch: vi.fn(),
  unlock: vi.fn(),
}));
vi.mock("@/server/auth", () => ({
  getSessionUser: async () => ({ uid: "user" }),
}));
vi.mock("@/server/podcasts/selection", () => ({
  requireSelectedPodcastForApi: async () => 1,
}));
vi.mock("@/server/env", () => ({ isLocalUiDemoEnabled: () => false }));
vi.mock("@/server/episodes/data-repository", () => ({
  findEpisode: async () => mocks.episode,
  listDirectorInterventions: async () => [],
  listPolicyFindings: async () => [],
  markEpisodeEditing: mocks.claim,
  updateDirectorInterventions: vi.fn(),
}));
vi.mock("@/server/db", () => ({
  getDbPool: async () => ({ query: mocks.unlock }),
}));
vi.mock("@/server/episodes/automator-jobs", () => ({
  runAutomatorJob: mocks.job,
}));
vi.mock("@/server/policy/repository", () => ({
  createPolicyEditPlan: mocks.plan,
  policyContentRef: () => ({
    collection: (name: string) => ({
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () =>
            name === "policy_reviews"
              ? { lockedPlanId: "00000000-0000-4000-8000-000000000001" }
              : { status: "queued", sourcePath: "source.wav" },
        }),
        set: mocks.markDispatch,
        update: mocks.markDispatch,
      }),
    }),
  }),
}));
import { POST } from "./route";
const context = { params: Promise.resolve({ id: "2" }) };
function apply(body: object) {
  return POST(
    new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    context,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.episode.status = "awaiting_approval";
  mocks.claim.mockResolvedValue(true);
  mocks.plan.mockResolvedValue({ id: "plan", sourcePath: "source.wav" });
  mocks.job.mockResolvedValue({ executionName: "execution" });
});
describe("frozen policy edit dispatch", () => {
  it("claims the episode before dispatch and rejects a concurrent second claim", async () => {
    expect((await apply({ planVersion: 2 })).status).toBe(200);
    expect(mocks.claim.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.job.mock.invocationCallOrder[0],
    );
    expect(mocks.job).toHaveBeenCalledWith({
      podcastId: 1,
      gcsTriggerObjectName: "source.wav",
      resumeFromAudit: true,
      editPlanId: "plan",
    });
    mocks.claim.mockResolvedValue(false);
    expect((await apply({ planVersion: 2 })).status).toBe(409);
    expect(mocks.job).toHaveBeenCalledTimes(1);
  });
  it("retains a frozen plan on ambiguous dispatch errors instead of permitting a different edit", async () => {
    mocks.job.mockRejectedValue(new Error("network"));
    expect((await apply({ planVersion: 2 })).status).toBe(500);
    expect(mocks.markDispatch).toHaveBeenCalledWith(
      { dispatchError: true },
      { merge: true },
    );
    expect(mocks.unlock).not.toHaveBeenCalled();
  });
  it("unlocks when validation failed before a plan was created", async () => {
    mocks.plan.mockRejectedValue(new Error("stale review"));
    expect((await apply({ planVersion: 2 })).status).toBe(500);
    expect(mocks.unlock).toHaveBeenCalled();
    expect(mocks.job).not.toHaveBeenCalled();
  });
  it("retries only the already frozen plan", async () => {
    mocks.episode.status = "editing";
    expect(
      (await apply({ retryPlanId: "00000000-0000-4000-8000-000000000001" }))
        .status,
    ).toBe(200);
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.job.mock.lastCall?.[0].editPlanId).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(
      (await apply({ retryPlanId: "00000000-0000-4000-8000-000000000002" }))
        .status,
    ).toBe(404);
  });
});
