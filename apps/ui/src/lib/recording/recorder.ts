// 1 本の音声トラックを録ってチャンクに分ける（#166）。
//
// - 基本は MediaRecorder（WebM/Opus）。同じ MediaRecorder のチャンクを順に連結すると
//   1 本の WebM になる（先頭チャンクにヘッダが入る）。
// - MediaRecorder が WebM/Ogg の Opus を録れないブラウザでは AudioWorklet で PCM を取り、
//   チャンクごとに独立した WAV にする。
// - Safari の audio/mp4 は timeslice で区切ると連結時に壊れるため使わない。
//
// 「セグメント」は録音を 1 回連続で動かした区間。リロード・マイク復帰・再入室のたびに
// 新しいセグメントになり、開始時刻（サーバー時刻）を持つ。mixer はこれで配置する。

export type RecordedChunk = {
  segment: string;
  seq: number;
  segmentStartMs: number;
  chunkStartMs: number;
  durationMs: number | null;
  sampleRate: number | null;
  mime: string;
  blob: Blob;
};

export type RecorderOptions = {
  track: MediaStreamTrack;
  serverNow: () => number;
  onChunk: (chunk: RecordedChunk) => void;
  onError?: (error: unknown) => void;
  bitsPerSecond?: number;
  timesliceMs?: number;
  forceWav?: boolean;
};

const MEDIA_RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"];

export function pickRecorderMimeType(
  isTypeSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
): string | null {
  return MEDIA_RECORDER_TYPES.find((type) => isTypeSupported(type)) ?? null;
}

export function newSegmentId(startMs: number): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `s${Math.round(startMs)}-${random}`;
}

export interface TrackRecorder {
  readonly format: "mediarecorder" | "wav";
  readonly segment: string | null;
  start(): Promise<void>;
  // 手元に溜まっている分を今すぐチャンクとして出す（画面が隠れたとき）
  flush(): void;
  stop(): Promise<void>;
}

export function createTrackRecorder(options: RecorderOptions): TrackRecorder {
  const mimeType = options.forceWav ? null : pickRecorderMimeType();
  return mimeType ? new MediaRecorderTrackRecorder(options, mimeType) : new WavTrackRecorder(options);
}

class MediaRecorderTrackRecorder implements TrackRecorder {
  readonly format = "mediarecorder" as const;
  segment: string | null = null;
  private recorder: MediaRecorder | null = null;
  private seq = 0;
  private segmentStartMs = 0;
  private lastChunkAt = 0;
  private stopped: Promise<void> | null = null;

  constructor(
    private readonly options: RecorderOptions,
    private readonly mimeType: string,
  ) {}

  start(): Promise<void> {
    const recorder = new MediaRecorder(new MediaStream([this.options.track]), {
      mimeType: this.mimeType,
      audioBitsPerSecond: this.options.bitsPerSecond ?? 128_000,
    });
    this.recorder = recorder;
    this.seq = 0;
    const baseMime = this.mimeType.split(";")[0];
    const started = new Promise<void>((resolve) => {
      recorder.onstart = () => {
        this.segmentStartMs = this.options.serverNow();
        this.lastChunkAt = this.segmentStartMs;
        this.segment = newSegmentId(this.segmentStartMs);
        resolve();
      };
    });
    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0 || !this.segment) return;
      const now = this.options.serverNow();
      this.options.onChunk({
        segment: this.segment,
        seq: this.seq,
        segmentStartMs: this.segmentStartMs,
        chunkStartMs: this.lastChunkAt,
        durationMs: now - this.lastChunkAt,
        sampleRate: null,
        mime: baseMime,
        blob: event.data,
      });
      this.seq += 1;
      this.lastChunkAt = now;
    };
    recorder.onerror = (event) => this.options.onError?.(event);
    this.stopped = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });
    recorder.start(this.options.timesliceMs ?? 10_000);
    return started;
  }

  flush() {
    if (this.recorder?.state === "recording") this.recorder.requestData();
  }

  async stop() {
    if (!this.recorder || this.recorder.state === "inactive") return;
    this.recorder.stop();
    await this.stopped;
  }
}

const WORKLET_SOURCE = `
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("sparkcast-pcm-tap", PcmTap);
`;

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

class WavTrackRecorder implements TrackRecorder {
  readonly format = "wav" as const;
  segment: string | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private buffers: Float32Array[] = [];
  private bufferedSamples = 0;
  private emittedSamples = 0;
  private seq = 0;
  private segmentStartMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: RecorderOptions) {}

  async start() {
    const context = new AudioContext();
    this.context = context;
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (context.state === "suspended") await context.resume().catch(() => undefined);
    this.source = context.createMediaStreamSource(new MediaStream([this.options.track]));
    this.node = new AudioWorkletNode(context, "sparkcast-pcm-tap");
    const mute = context.createGain();
    mute.gain.value = 0;
    this.source.connect(this.node);
    this.node.connect(mute).connect(context.destination);

    this.seq = 0;
    this.emittedSamples = 0;
    this.segmentStartMs = this.options.serverNow();
    this.segment = newSegmentId(this.segmentStartMs);
    this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      this.buffers.push(event.data);
      this.bufferedSamples += event.data.length;
    };
    this.timer = setInterval(() => this.flush(), this.options.timesliceMs ?? 10_000);
  }

  flush() {
    if (!this.context || !this.segment || this.bufferedSamples === 0) return;
    const samples = new Float32Array(this.bufferedSamples);
    let offset = 0;
    for (const buffer of this.buffers) {
      samples.set(buffer, offset);
      offset += buffer.length;
    }
    this.buffers = [];
    this.bufferedSamples = 0;
    const sampleRate = this.context.sampleRate;
    this.options.onChunk({
      segment: this.segment,
      seq: this.seq,
      segmentStartMs: this.segmentStartMs,
      chunkStartMs: this.segmentStartMs + (this.emittedSamples / sampleRate) * 1000,
      durationMs: (samples.length / sampleRate) * 1000,
      sampleRate,
      mime: "audio/wav",
      blob: encodeWav(samples, sampleRate),
    });
    this.emittedSamples += samples.length;
    this.seq += 1;
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
    this.source?.disconnect();
    this.node?.disconnect();
    await this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
