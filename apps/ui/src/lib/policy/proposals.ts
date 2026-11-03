import type { PolicyEditProposal, PolicyFinding } from "@/types/episode";

export function groupPolicyFindings(
  findings: PolicyFinding[],
): PolicyEditProposal[] {
  const groups: PolicyFinding[][] = [];
  for (const finding of [...findings].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    const group = groups.find((items) =>
      items.some(
        (item) => item.start < finding.end && finding.start < item.end,
      ),
    );
    if (group) group.push(finding);
    else groups.push([finding]);
  }
  // A broad finding can bridge two earlier groups. Merge connected components.
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (
        groups[i].some((a) =>
          groups[j].some((b) => a.start < b.end && b.start < a.end),
        )
      ) {
        groups[i].push(...groups.splice(j, 1)[0]);
        j = i;
      }
    }
  }
  return groups.map((items) => ({
    id: items.map((item) => item.id).sort()[0],
    findingIds: items.map((item) => item.id).sort(),
    findings: items,
    start: Math.min(...items.map((item) => item.start)),
    end: Math.max(...items.map((item) => item.end)),
    action: "silence",
    recommendedAction: "silence",
    reason: "対象箇所を無音化し、検知された情報を原音声から除去します。",
    script: "",
    status: "pending",
    assetId: null,
    rangeConfirmed: false,
    rangePrecision: items.every((item) => item.rangePrecision === "word")
      ? "word"
      : "chunk",
  }));
}

export function validateProposalCoverage(
  proposals: PolicyEditProposal[],
  findings: PolicyFinding[],
): void {
  const covered = proposals.flatMap((proposal) => proposal.findingIds);
  if (
    new Set(covered).size !== covered.length ||
    covered.length !== findings.length ||
    findings.some((finding) => !covered.includes(finding.id))
  ) {
    throw new Error("指摘の対応が不完全です。再読み込みしてください。");
  }
  const approved = proposals
    .filter((proposal) => proposal.status === "approved")
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i < approved.length; i++) {
    const proposal = approved[i];
    if (
      !Number.isFinite(proposal.start) ||
      !Number.isFinite(proposal.end) ||
      proposal.start < 0 ||
      proposal.start >= proposal.end
    ) {
      throw new Error("編集範囲が不正です。");
    }
    if (!proposal.rangeConfirmed)
      throw new Error("対象範囲を確認してください。");
    if (i > 0 && approved[i - 1].end > proposal.start)
      throw new Error("承認した編集範囲が重複しています。");
    for (const id of proposal.findingIds) {
      const finding = findings.find((item) => item.id === id)!;
      // Word-aligned evidence must be fully removed. Chunk estimates may be refined by the reviewer.
      if (
        finding.rangePrecision === "word" &&
        (proposal.start > finding.start || proposal.end < finding.end)
      ) {
        throw new Error("確認済みの検知箇所が編集範囲から外れています。");
      }
    }
    if (
      proposal.action === "replace" &&
      (!proposal.assetId || !proposal.script.trim())
    ) {
      throw new Error("置換する音声と台詞を準備してください。");
    }
  }
}
