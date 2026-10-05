// 録音チャンクの一時置き場（IndexedDB）（#166）。
// 録れたらまずここに入れ、送れたら消す。タブを閉じても残るので、入り直したときに再送できる。
// IndexedDB が使えない環境（プライベートブラウズ等）ではメモリに置く。

export type ChunkMeta = {
  sessionId: string;
  uploaderId: string;
  kind: "local" | "backup";
  subject: string;
  segment: string;
  seq: number;
  segmentStartMs: number;
  chunkStartMs: number;
  durationMs: number | null;
  sampleRate: number | null;
  mime: string;
  createdAt: number;
};

export type StoredChunk = ChunkMeta & { id: string; blob: Blob };

export interface ChunkStore {
  put(chunk: StoredChunk): Promise<void>;
  list(sessionId: string, uploaderId: string): Promise<StoredChunk[]>;
  delete(id: string): Promise<void>;
}

export function chunkId(meta: Pick<ChunkMeta, "sessionId" | "kind" | "subject" | "segment" | "seq">): string {
  return `${meta.sessionId}/${meta.kind}/${meta.subject}/${meta.segment}/${meta.seq}`;
}

const DB_NAME = "sparkcast-recording";
const STORE = "chunks";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

class IndexedDbChunkStore implements ChunkStore {
  private db: Promise<IDBDatabase>;

  constructor() {
    this.db = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        const store = open.result.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("byUploader", ["sessionId", "uploaderId"]);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  async put(chunk: StoredChunk) {
    const db = await this.db;
    await request(db.transaction(STORE, "readwrite").objectStore(STORE).put(chunk));
  }

  async list(sessionId: string, uploaderId: string) {
    const db = await this.db;
    const index = db.transaction(STORE, "readonly").objectStore(STORE).index("byUploader");
    const chunks = (await request(index.getAll([sessionId, uploaderId]))) as StoredChunk[];
    return chunks.sort((a, b) => a.createdAt - b.createdAt);
  }

  async delete(id: string) {
    const db = await this.db;
    await request(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
  }
}

export class MemoryChunkStore implements ChunkStore {
  private chunks = new Map<string, StoredChunk>();

  async put(chunk: StoredChunk) {
    this.chunks.set(chunk.id, chunk);
  }

  async list(sessionId: string, uploaderId: string) {
    return [...this.chunks.values()]
      .filter((chunk) => chunk.sessionId === sessionId && chunk.uploaderId === uploaderId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async delete(id: string) {
    this.chunks.delete(id);
  }
}

export async function openChunkStore(): Promise<{ store: ChunkStore; persistent: boolean }> {
  try {
    if (typeof indexedDB === "undefined") throw new Error("no indexedDB");
    const store = new IndexedDbChunkStore();
    // 開けることを確かめる（Safari のプライベートブラウズ等では失敗する）
    await store.list("probe", "probe");
    // 容量不足で消されにくくする（許可されなくても続行）
    await navigator.storage?.persist?.().catch(() => false);
    return { store, persistent: true };
  } catch {
    return { store: new MemoryChunkStore(), persistent: false };
  }
}
