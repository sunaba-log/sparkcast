import type { ChunkStore, StoredChunk } from "@/lib/recording/chunk-store";

// 録音チャンクを 1 つずつ Worker に送る（#166）。送れたら IndexedDB から消す。
// 回線断や 5xx は待って送り直し、401 はトークンを取り直してから送り直す。

export type UploaderOptions = {
  baseUrl: string;
  sessionId: string;
  uploaderId: string;
  store: ChunkStore;
  getToken: () => string;
  onUnauthorized: () => Promise<void>;
  onChange?: (state: { pending: number; uploaded: number; lastError: string | null }) => void;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];

export function buildChunkUrl(baseUrl: string, chunk: StoredChunk): string {
  const params = new URLSearchParams({
    kind: chunk.kind,
    subject: chunk.subject,
    segment: chunk.segment,
    seq: String(chunk.seq),
    segmentStart: String(Math.max(0, Math.round(chunk.segmentStartMs))),
    chunkStart: String(Math.max(0, Math.round(chunk.chunkStartMs))),
  });
  if (chunk.durationMs !== null) params.set("duration", String(Math.round(chunk.durationMs)));
  if (chunk.sampleRate !== null) params.set("rate", String(chunk.sampleRate));
  return `${baseUrl}/rooms/${chunk.sessionId}/chunks?${params.toString()}`;
}

export class ChunkUploader {
  private queue: StoredChunk[] = [];
  private running = false;
  private stopped = false;
  private uploaded = 0;
  private lastError: string | null = null;
  private wake: (() => void) | null = null;

  constructor(private readonly options: UploaderOptions) {}

  // 前回送り切れなかった分（リロード前のタブなど）を読み込んで送り始める
  async resume() {
    const leftovers = await this.options.store.list(this.options.sessionId, this.options.uploaderId);
    const known = new Set(this.queue.map((chunk) => chunk.id));
    for (const chunk of leftovers) {
      if (!known.has(chunk.id)) this.queue.push(chunk);
    }
    this.notify();
    this.pump();
  }

  async enqueue(chunk: StoredChunk) {
    try {
      await this.options.store.put(chunk);
    } catch {
      // 保存できなくても送信は試みる
    }
    this.queue.push(chunk);
    this.notify();
    this.pump();
  }

  get pending(): number {
    return this.queue.length;
  }

  // 待機中のリトライを中断して、すぐに送り直す（回線復帰・画面復帰時）
  retryNow() {
    this.wake?.();
  }

  stop() {
    this.stopped = true;
    this.wake?.();
  }

  private notify() {
    this.options.onChange?.({ pending: this.queue.length, uploaded: this.uploaded, lastError: this.lastError });
  }

  private sleep(ms: number): Promise<void> {
    if (this.options.sleep) return this.options.sleep(ms);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
    });
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    let failures = 0;
    try {
      while (!this.stopped && this.queue.length > 0) {
        const chunk = this.queue[0];
        const outcome = await this.send(chunk);
        if (outcome === "done" || outcome === "drop") {
          this.queue.shift();
          await this.options.store.delete(chunk.id).catch(() => undefined);
          if (outcome === "done") this.uploaded += 1;
          failures = 0;
          this.lastError = outcome === "drop" ? this.lastError : null;
          this.notify();
          continue;
        }
        if (outcome === "fatal") {
          this.stopped = true;
          break;
        }
        if (outcome === "unauthorized") {
          await this.options.onUnauthorized().catch(() => undefined);
        }
        this.notify();
        await this.sleep(RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)]);
        failures += 1;
      }
    } finally {
      this.running = false;
    }
  }

  private async send(chunk: StoredChunk): Promise<"done" | "drop" | "retry" | "unauthorized" | "fatal"> {
    try {
      const response = await (this.options.fetchImpl ?? fetch)(buildChunkUrl(this.options.baseUrl, chunk), {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.options.getToken()}`,
          "Content-Type": chunk.mime,
        },
        body: chunk.blob,
      });
      if (response.ok) return "done";
      const text = await response.text().catch(() => "");
      this.lastError = `${response.status} ${text.slice(0, 120)}`;
      if (response.status === 401) return "unauthorized";
      // 収録外・容量超過・不正なパラメータは何度送っても受け付けられない
      if (response.status === 409 || response.status === 400 || response.status === 413) return "drop";
      if (response.status === 403) return "fatal";
      return "retry";
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return "retry";
    }
  }
}
