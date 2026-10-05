import { describe, expect, it, vi } from "vitest";
import { MemoryChunkStore, chunkId, type StoredChunk } from "@/lib/recording/chunk-store";
import { buildChunkUrl, ChunkUploader } from "@/lib/recording/uploader";

function chunk(seq: number, overrides: Partial<StoredChunk> = {}): StoredChunk {
  const meta = {
    sessionId: "sid",
    uploaderId: "me",
    kind: "local" as const,
    subject: "me",
    segment: "s1",
    seq,
    segmentStartMs: 1000.4,
    chunkStartMs: 1000.4 + seq * 10_000,
    durationMs: null,
    sampleRate: null,
    mime: "audio/webm",
    createdAt: seq,
    ...overrides,
  };
  return { ...meta, id: chunkId(meta), blob: new Blob([new Uint8Array([seq])]) };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("buildChunkUrl", () => {
  it("encodes the chunk metadata as integer query parameters", () => {
    const url = new URL(buildChunkUrl("https://rt.example", chunk(2, { durationMs: 9999.6, sampleRate: 48000 })));
    expect(url.pathname).toBe("/rooms/sid/chunks");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: "local",
      subject: "me",
      segment: "s1",
      seq: "2",
      segmentStart: "1000",
      chunkStart: "21000",
      duration: "10000",
      rate: "48000",
    });
  });
});

describe("ChunkUploader", () => {
  function setup(responses: (Response | Error)[]) {
    const store = new MemoryChunkStore();
    const fetchImpl = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
      const next = responses.shift() ?? new Response("{}", { status: 201 });
      if (next instanceof Error) throw next;
      return next;
    });
    const onUnauthorized = vi.fn(async () => undefined);
    let token = "t1";
    const uploader = new ChunkUploader({
      baseUrl: "https://rt.example",
      sessionId: "sid",
      uploaderId: "me",
      store,
      getToken: () => token,
      onUnauthorized: async () => {
        token = "t2";
        await onUnauthorized();
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });
    return { store, fetchImpl, uploader, onUnauthorized };
  }

  it("uploads in order and removes chunks from the store", async () => {
    const { store, fetchImpl, uploader } = setup([]);
    await uploader.enqueue(chunk(0));
    await uploader.enqueue(chunk(1));
    await vi.waitFor(() => expect(uploader.pending).toBe(0));
    expect(fetchImpl.mock.calls.map((call) => new URL(String(call[0])).searchParams.get("seq"))).toEqual(["0", "1"]);
    expect(await store.list("sid", "me")).toHaveLength(0);
  });

  it("retries network errors and server errors", async () => {
    const { fetchImpl, uploader } = setup([new Error("offline"), new Response("", { status: 503 })]);
    await uploader.enqueue(chunk(0));
    await vi.waitFor(() => expect(uploader.pending).toBe(0));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("refreshes the token after a 401 and retries with the new one", async () => {
    const { fetchImpl, uploader, onUnauthorized } = setup([new Response("", { status: 401 })]);
    await uploader.enqueue(chunk(0));
    await vi.waitFor(() => expect(uploader.pending).toBe(0));
    expect(onUnauthorized).toHaveBeenCalledOnce();
    const lastInit = fetchImpl.mock.calls.at(-1)?.[1] as RequestInit;
    expect((lastInit.headers as Record<string, string>).Authorization).toBe("Bearer t2");
  });

  it("drops chunks the room will never accept and keeps going", async () => {
    const { fetchImpl, uploader, store } = setup([new Response("room is closed", { status: 409 })]);
    await uploader.enqueue(chunk(0));
    await uploader.enqueue(chunk(1));
    await vi.waitFor(() => expect(uploader.pending).toBe(0));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await store.list("sid", "me")).toHaveLength(0);
  });

  it("stops when the participant is no longer allowed", async () => {
    const { fetchImpl, uploader } = setup([new Response("", { status: 403 })]);
    await uploader.enqueue(chunk(0));
    await flush();
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(uploader.pending).toBe(1);
  });

  it("resumes chunks left in the store by a previous tab", async () => {
    const { store, fetchImpl, uploader } = setup([]);
    await store.put(chunk(5));
    await store.put(chunk(6, { uploaderId: "someone-else" }));
    await uploader.resume();
    await vi.waitFor(() => expect(uploader.pending).toBe(0));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
