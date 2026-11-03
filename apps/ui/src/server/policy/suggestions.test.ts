import { beforeEach, describe, expect, it, vi } from "vitest";
const generate = vi.hoisted(() => vi.fn());
vi.mock("@/server/chat/vertex-client", () => ({
  getVertexAi: () => ({ models: { generateContent: generate } }),
}));
vi.mock("@/server/env", () => ({ getVertexAiModel: () => "test" }));
import { suggestPolicyEdits } from "./suggestions";
import type { PolicyFinding } from "@/types/episode";
const findings: PolicyFinding[] = [
  {
    id: "pii",
    chunkId: "seg_00001",
    category: "pii",
    source: "presidio",
    start: 1,
    end: 2,
    text: "秘密",
    entityType: null,
    action: "silence",
    status: "pending",
    wordIds: ["seg_00001:w0000"],
    rangePrecision: "word",
  },
  {
    id: "jev",
    chunkId: "seg_00001",
    category: "confidential_information",
    source: "jev",
    start: 0,
    end: 3,
    text: "秘密",
    entityType: null,
    action: "silence",
    status: "pending",
  },
];
const words = [
  { wordId: "seg_00001:w0000", text: "秘密", start: 1, end: 2 },
  { wordId: "seg_00002:w0000", text: "別の発話", start: 5, end: 6 },
];
beforeEach(() => generate.mockReset());
describe("autonomous action proposals", () => {
  it("unifies PII and Jev into a word-aligned replacement proposal", async () => {
    generate.mockResolvedValue({
      text: JSON.stringify({
        proposals: [
          {
            findingIds: ["pii", "jev"],
            wordIds: [words[0].wordId],
            action: "replace",
            reason: "安全な言い換え",
            script: "省略します",
          },
        ],
      }),
    });
    const [proposal] = await suggestPolicyEdits(findings, words);
    expect(proposal).toMatchObject({
      findingIds: ["pii", "jev"],
      start: 1,
      end: 2,
      script: "省略します",
      status: "pending",
    });
    expect(generate.mock.lastCall?.[0].contents).not.toContain("別の発話");
  });
  it("rejects hallucinated words and incomplete evidence coverage", async () => {
    generate.mockResolvedValue({
      text: JSON.stringify({
        proposals: [
          {
            findingIds: ["pii", "jev"],
            wordIds: ["unknown"],
            action: "cut",
            reason: "除去",
            script: "",
          },
        ],
      }),
    });
    await expect(suggestPolicyEdits(findings, words)).rejects.toThrow(
      "未知の単語",
    );
    generate.mockResolvedValue({
      text: JSON.stringify({
        proposals: [
          {
            findingIds: ["pii"],
            wordIds: [words[0].wordId],
            action: "cut",
            reason: "除去",
            script: "",
          },
        ],
      }),
    });
    await expect(suggestPolicyEdits(findings, words)).rejects.toThrow("不完全");
  });
});
