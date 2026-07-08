import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  replaceSourceChunks,
  searchRelevantChunks,
} from "@/server/chat/knowledge-index";

const isElasticsearchEnabled = vi.fn<() => boolean>();
const esSearchHybridChunks = vi.fn().mockResolvedValue([]);
const esReplaceSourceChunks = vi.fn().mockResolvedValue(undefined);
const firestoreSearchSimilarChunks = vi.fn().mockResolvedValue([]);
const firestoreReplaceSourceChunks = vi.fn().mockResolvedValue(undefined);

vi.mock("@/server/chat/elasticsearch-client", () => ({
  isElasticsearchEnabled: () => isElasticsearchEnabled(),
}));
vi.mock("@/server/chat/elasticsearch-index", () => ({
  getIndexedSourceHash: vi.fn(),
  listIndexedSourceKeys: vi.fn(),
  deleteSourceChunks: vi.fn(),
  replaceSourceChunks: (...args: unknown[]) => esReplaceSourceChunks(...args),
  searchHybridChunks: (...args: unknown[]) => esSearchHybridChunks(...args),
}));
vi.mock("@/server/chat/vector-index", () => ({
  getIndexedSourceHash: vi.fn(),
  listIndexedSourceKeys: vi.fn(),
  deleteSourceChunks: vi.fn(),
  replaceSourceChunks: (...args: unknown[]) =>
    firestoreReplaceSourceChunks(...args),
  searchSimilarChunks: (...args: unknown[]) =>
    firestoreSearchSimilarChunks(...args),
}));

const replaceInput = {
  podcastId: 1,
  sourceType: "minutes" as const,
  sourceKey: "minutes:1",
  title: "t",
  url: "/?episode=1",
  contentHash: "hash",
  chunks: [],
  embeddings: [],
};

describe("knowledge-index dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Elasticsearch 有効時はハイブリッド検索を使う", async () => {
    isElasticsearchEnabled.mockReturnValue(true);
    await searchRelevantChunks(1, { text: "質問", vector: [0.1] }, 12);
    expect(esSearchHybridChunks).toHaveBeenCalledWith(1, "質問", [0.1], 12);
    expect(firestoreSearchSimilarChunks).not.toHaveBeenCalled();
  });

  it("Elasticsearch 無効時は Firestore ベクトル検索を使う", async () => {
    isElasticsearchEnabled.mockReturnValue(false);
    await searchRelevantChunks(1, { text: "質問", vector: [0.1] }, 12);
    expect(firestoreSearchSimilarChunks).toHaveBeenCalledWith(1, [0.1], 12);
    expect(esSearchHybridChunks).not.toHaveBeenCalled();
  });

  it("インデックス操作もバックエンド設定に従う", async () => {
    isElasticsearchEnabled.mockReturnValue(true);
    await replaceSourceChunks(replaceInput);
    expect(esReplaceSourceChunks).toHaveBeenCalledWith(replaceInput);

    isElasticsearchEnabled.mockReturnValue(false);
    await replaceSourceChunks(replaceInput);
    expect(firestoreReplaceSourceChunks).toHaveBeenCalledWith(replaceInput);
  });
});
