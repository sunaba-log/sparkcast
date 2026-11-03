import { describe, expect, it } from "vitest";
import { groupPolicyFindings, validateProposalCoverage } from "./proposals";
import type { PolicyFinding } from "@/types/episode";
const finding = (
  id: string,
  start: number,
  end: number,
  category: PolicyFinding["category"] = "pii",
): PolicyFinding => ({
  id,
  start,
  end,
  category,
  chunkId: "seg_00001",
  source: category === "pii" ? "presidio" : "jev",
  text: "監査対象",
  entityType: null,
  action: "silence",
  status: "pending",
  rangePrecision: "word",
});
describe("policy proposal integration", () => {
  it("merges overlapping PII/Jev evidence without merging separate spans in one chunk", () => {
    const groups = groupPolicyFindings([
      finding("pii", 1, 2),
      finding("jev", 1, 3, "third_party_risk"),
      finding("other", 5, 6),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].findingIds).toEqual(["jev", "pii"]);
    expect(groups[0].end).toBe(3);
  });
  it("handles a broad finding bridging two disjoint groups", () => {
    expect(
      groupPolicyFindings([
        finding("a", 1, 2),
        finding("b", 5, 6),
        finding("broad", 1.5, 5.5),
      ]),
    ).toHaveLength(1);
  });
  it("rejects missing evidence, overlapping approvals and clipping confirmed PII", () => {
    const findings = [finding("a", 1, 2), finding("b", 5, 6)];
    const proposals = groupPolicyFindings(findings).map((p) => ({
      ...p,
      status: "approved" as const,
      rangeConfirmed: true,
    }));
    expect(() =>
      validateProposalCoverage(proposals.slice(1), findings),
    ).toThrow("不完全");
    expect(() =>
      validateProposalCoverage(
        [{ ...proposals[0], end: 5.5 }, proposals[1]],
        findings,
      ),
    ).toThrow("重複");
    expect(() =>
      validateProposalCoverage(
        [{ ...proposals[0], start: 1.1 }, proposals[1]],
        findings,
      ),
    ).toThrow("外れ");
  });
  it("requires confirmation and an asset for replacement", () => {
    const findings = [finding("a", 1, 2)];
    const [p] = groupPolicyFindings(findings);
    expect(() =>
      validateProposalCoverage([{ ...p, status: "approved" }], findings),
    ).toThrow("確認");
    expect(() =>
      validateProposalCoverage(
        [{ ...p, status: "approved", rangeConfirmed: true, action: "replace" }],
        findings,
      ),
    ).toThrow("音声");
  });
});
