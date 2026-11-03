import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PolicyFinding } from "@/types/episode";
const state = vi.hoisted(() => ({
  documents: new Map<string, Record<string, unknown>>(),
  generation: "1",
  findings: [] as PolicyFinding[],
}));
function ref(path: string) {
  return {
    path,
    collection: (name: string) => ({
      doc: (id: string) => ref(`${path}/${name}/${id}`),
      orderBy: () => ({
        get: async () => ({
          docs: [
            {
              id: "seg_00001",
              data: () => ({
                text: "連絡先",
                words: [{ text: "連絡先", start: 1, end: 2 }],
              }),
            },
          ],
        }),
      }),
    }),
    get: async () => ({
      exists: state.documents.has(path),
      data: () => state.documents.get(path),
    }),
    create: async (data: Record<string, unknown>) => {
      state.documents.set(path, data);
    },
  };
}
vi.mock("@/server/firebase-admin", () => ({
  getAdminFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ref(`${name}/${id}`),
    }),
    runTransaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        get: (r: ReturnType<typeof ref>) => r.get(),
        set: (r: ReturnType<typeof ref>, data: Record<string, unknown>) =>
          state.documents.set(r.path, data),
        create: (r: ReturnType<typeof ref>, data: Record<string, unknown>) =>
          state.documents.set(r.path, data),
        update: (r: ReturnType<typeof ref>, data: Record<string, unknown>) =>
          state.documents.set(r.path, {
            ...state.documents.get(r.path),
            ...data,
          }),
      }),
  }),
}));
vi.mock("@/server/storage", () => ({
  getStorage: () => ({
    bucket: () => ({
      file: () => ({
        getMetadata: async () => [{ generation: state.generation }],
      }),
    }),
  }),
}));
vi.mock("@/server/db", () => ({
  getDbPool: async () => ({
    query: async () => ({
      rows: [{ source_audio_path: "podcasts/1/episodes/2/source/test.wav" }],
    }),
  }),
}));
vi.mock("@/server/env", () => ({ getUploadBucket: () => "source" }));
vi.mock("@/server/episodes/data-repository", () => ({
  listPolicyFindings: async () => state.findings,
  listDirectorInterventions: async () => [],
}));
import {
  loadPolicyReview,
  savePolicyReview,
  createPolicyEditPlan,
} from "./repository";
const root = "podcasts/1/episodes_contents/2";
beforeEach(() => {
  state.documents.clear();
  state.generation = "1";
  state.findings = [
    {
      id: "a",
      chunkId: "seg_00001",
      category: "pii",
      source: "presidio",
      start: 1,
      end: 2,
      text: "連絡先",
      action: "silence",
      status: "pending",
      entityType: null,
      rangePrecision: "word",
    },
  ];
});
describe("saved policy reviews", () => {
  it("saves decisions with optimistic locking and keeps large transcript data outside the review document", async () => {
    const review = await loadPolicyReview(1, 2);
    expect(review.words).toHaveLength(1);
    const stored = state.documents.get(`${root}/policy_reviews/current`)!;
    expect(stored.words).toBeUndefined();
    expect(
      (stored.proposals as Record<string, unknown>[])[0].findings,
    ).toBeUndefined();
    const proposals = review.proposals.map((p) => ({
      ...p,
      rangeConfirmed: true,
      status: "approved" as const,
    }));
    const saved = await savePolicyReview(
      1,
      2,
      review.version,
      proposals,
      "user",
    );
    expect(saved.version).toBe(review.version + 1);
    await expect(
      savePolicyReview(1, 2, review.version, proposals, "other"),
    ).rejects.toThrow("更新");
    const plan = await createPolicyEditPlan(1, 2, saved.version);
    expect(plan.operations).toEqual([
      {
        action: "silence",
        startMs: 1000,
        endMs: 2000,
        assetPath: null,
        assetHash: null,
        replacementTranscript: "",
      },
    ]);
    await expect(
      savePolicyReview(1, 2, saved.version, proposals, "user"),
    ).rejects.toThrow("更新");
  });
  it("rejects applying reviewed ranges to a different source generation", async () => {
    const review = await loadPolicyReview(1, 2);
    const saved = await savePolicyReview(
      1,
      2,
      review.version,
      review.proposals.map((p) => ({
        ...p,
        rangeConfirmed: true,
        status: "approved",
      })),
      "user",
    );
    state.generation = "2";
    await expect(createPolicyEditPlan(1, 2, saved.version)).rejects.toThrow(
      "原音声",
    );
  });
  it("refuses a replacement asset from another proposal", async () => {
    const review = await loadPolicyReview(1, 2);
    state.documents.set(`${root}/replacement_audio_assets/asset`, {
      id: "asset",
      proposalId: "other",
      script: "伏せます",
    });
    await expect(
      savePolicyReview(
        1,
        2,
        review.version,
        review.proposals.map((p) => ({
          ...p,
          action: "replace",
          assetId: "asset",
          script: "伏せます",
          rangeConfirmed: true,
          status: "approved",
        })),
        "user",
      ),
    ).rejects.toThrow("代替音声");
  });
});
