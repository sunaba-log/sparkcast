import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processPolicyMedia: vi.fn(),
  review: {
    version: 1,
    sourceGeneration: "gen1",
    transcriptRevision: "rev1",
    proposals: [{ id: "proposal-1" }],
  },
  interventions: [
    {
      id: "intervention-1",
      correctionScript: "テスト台詞",
      status: "pending",
      action: "insert",
      insertAt: 10,
    },
  ],
  fileSave: vi.fn(),
  getSignedUrl: vi.fn().mockResolvedValue(["https://signed.audio/url"]),
  assetCreate: vi.fn(),
}));

vi.mock("@/server/policy/api-context", () => ({
  policyApiContext: async () => ({ podcastId: 1, episodeId: 2, user: { uid: "user-1" } }),
  PolicyApiError: class extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/server/podcasts/data-repository", () => ({
  getPodcast: async () => ({
    audioAuditPolicy: { confidentialTerms: [], allowedTerms: [] },
  }),
}));

vi.mock("@/server/episodes/data-repository", () => ({
  listDirectorInterventions: async () => mocks.interventions,
}));

vi.mock("@/server/policy/media", () => ({
  processPolicyMedia: mocks.processPolicyMedia,
}));

vi.mock("@/server/policy/repository", () => ({
  loadPolicyReview: async () => mocks.review,
  policySource: async () => ({ path: "source.wav", generation: "gen1" }),
  policyAudioBucket: () => ({
    file: () => ({
      save: mocks.fileSave,
      getSignedUrl: mocks.getSignedUrl,
      download: async () => [Buffer.from("audio-bytes")],
    }),
  }),
  policyContentRef: () => ({
    collection: () => ({
      doc: () => ({
        create: mocks.assetCreate,
        get: async () => ({
          data: () => ({
            id: "00000000-0000-4000-8000-000000000001",
            proposalId: "intervention-1",
            script: "テスト台詞",
            objectPath: "policy/1/2/assets/test.wav",
          }),
        }),
      }),
    }),
  }),
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ id: "2" }) };

function callPost(body: object) {
  return POST(
    new Request("https://example.test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    context,
  );
}

describe("POST /api/episodes/[id]/policy-audio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processPolicyMedia.mockResolvedValue({
      audioBase64: Buffer.from("dummy-audio").toString("base64"),
      durationMs: 1500,
      transcript: "テスト台詞",
    });
  });

  it("synthesizes audio for a director intervention without requiring policy review version", async () => {
    const response = await callPost({
      operation: "synthesize",
      proposalId: "intervention-1",
      script: "テスト台詞",
      action: "insert",
      start: 5,
      end: 10,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://signed.audio/url");
    expect(body.asset).toMatchObject({
      proposalId: "intervention-1",
      kind: "synthesized",
      script: "テスト台詞",
      transcript: "テスト台詞",
      durationMs: 1500,
    });
    expect(mocks.assetCreate).toHaveBeenCalledOnce();
  });

  it("synthesizes audio for a policy proposal with valid version", async () => {
    const response = await callPost({
      operation: "synthesize",
      version: 1,
      proposalId: "proposal-1",
      script: "代替台詞",
      action: "replace",
      start: 1,
      end: 3,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.asset.proposalId).toBe("proposal-1");
  });

  it("validates recorded audio for a director insert without a policy version", async () => {
    const audioBase64 = Buffer.from("recorded-audio").toString("base64");
    const response = await callPost({
      operation: "recording",
      proposalId: "intervention-1",
      script: "テスト台詞",
      action: "insert",
      audioBase64,
    });

    expect(response.status).toBe(200);
    expect((await response.json()).asset.kind).toBe("recorded");
    expect(mocks.processPolicyMedia).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "recording", audioBase64 }),
    );
    expect(mocks.fileSave).toHaveBeenCalledOnce();
  });

  it.each([undefined, 2])("rejects missing or stale policy version %s", async (version) => {
    const response = await callPost({
      operation: "synthesize",
      version,
      proposalId: "proposal-1",
      script: "代替台詞",
      action: "replace",
    });
    expect(response.status).toBe(409);
    expect(mocks.processPolicyMedia).not.toHaveBeenCalled();
  });

  it("validates recorded audio for a policy replacement", async () => {
    const response = await callPost({
      operation: "recording",
      version: 1,
      proposalId: "proposal-1",
      script: "代替台詞",
      action: "replace",
      audioBase64: Buffer.from("recorded-audio").toString("base64"),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).asset.kind).toBe("recorded");
  });

  it("fails when proposalId is not found in policy review or director interventions", async () => {
    const response = await callPost({
      operation: "synthesize",
      proposalId: "non-existent-id",
      script: "テスト台詞",
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("編集案が見つかりません。");
  });

  it("handles preview operation for director intervention insert action", async () => {
    const response = await callPost({
      operation: "preview",
      proposalId: "intervention-1",
      script: "テスト台詞",
      action: "insert",
      start: 5,
      end: 10,
      assetId: "00000000-0000-4000-8000-000000000001",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://signed.audio/url");
    expect(body.durationMs).toBe(1500);
  });
});
