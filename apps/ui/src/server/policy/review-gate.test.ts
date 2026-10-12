import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findings: [] as Array<{ status: string }>,
  interventions: [] as Array<{ status: string }>,
  mark: vi.fn(),
}));
vi.mock("@/server/episodes/data-repository", () => ({
  listPolicyFindings: async () => m.findings,
  listDirectorInterventions: async () => m.interventions,
  markEpisodeAwaitingPublishConfirmation: m.mark,
}));

import { canPublishOriginal, moveToPublishConfirmationIfAllRejected } from "./review-gate";

beforeEach(() => {
  m.findings = [];
  m.interventions = [];
  m.mark.mockReset().mockResolvedValue(true);
});

describe("review gate shared by every publish route", () => {
  it("moves to publish confirmation only when every finding and intervention is rejected", async () => {
    m.findings = [{ status: "rejected" }];
    m.interventions = [{ status: "pending" }];
    expect(await moveToPublishConfirmationIfAllRejected(1, 2)).toBe(false);
    m.interventions = [{ status: "approved" }];
    expect(await moveToPublishConfirmationIfAllRejected(1, 2)).toBe(false);
    m.interventions = [{ status: "rejected" }];
    expect(await moveToPublishConfirmationIfAllRejected(1, 2)).toBe(true);
    expect(m.mark).toHaveBeenCalledTimes(1);
  });

  it("covers episodes that only have fact-check interventions", async () => {
    m.interventions = [{ status: "rejected" }];
    expect(await moveToPublishConfirmationIfAllRejected(1, 2)).toBe(true);
  });

  it("does not move an episode without any review items", async () => {
    expect(await moveToPublishConfirmationIfAllRejected(1, 2)).toBe(false);
    expect(m.mark).not.toHaveBeenCalled();
  });

  it("allows publishing the original only when nothing is undecided or approved", async () => {
    expect(await canPublishOriginal(1, 2)).toBe(true); // 再監査で指摘なし（確認待ち）
    m.findings = [{ status: "rejected" }];
    expect(await canPublishOriginal(1, 2)).toBe(true);
    m.interventions = [{ status: "pending" }];
    expect(await canPublishOriginal(1, 2)).toBe(false);
    m.interventions = [{ status: "approved" }];
    expect(await canPublishOriginal(1, 2)).toBe(false);
  });
});
