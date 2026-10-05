// 音量メーター（発話インジケーター）用。トラックごとに AnalyserNode を付けて RMS を取る。

export class LevelMonitor {
  private context: AudioContext | null = null;
  private nodes = new Map<string, { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; trackId: string }>();
  private buffer = new Float32Array(1024);
  private removeGestureListeners: (() => void) | null = null;

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
      this.listenForGesture();
    }
    if (this.context.state === "suspended") void this.context.resume().catch(() => undefined);
    return this.context;
  }

  // Safari などは、クリックの処理の中で作られなかった AudioContext を止めたままにする（メーターが動かない）。
  // 画面への操作があるたびに再開を試みる
  private listenForGesture() {
    if (typeof document === "undefined" || this.removeGestureListeners) return;
    const resume = () => this.resume();
    const events = ["pointerdown", "keydown", "touchend"] as const;
    for (const event of events) document.addEventListener(event, resume, { capture: true, passive: true });
    this.removeGestureListeners = () => {
      for (const event of events) document.removeEventListener(event, resume, { capture: true });
    };
  }

  resume() {
    if (this.context?.state === "suspended") void this.context.resume().catch(() => undefined);
  }

  set(key: string, track: MediaStreamTrack | null) {
    const existing = this.nodes.get(key);
    if (existing && track && existing.trackId === track.id) return;
    if (existing) {
      existing.source.disconnect();
      this.nodes.delete(key);
    }
    if (!track) return;
    const context = this.ensureContext();
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    this.nodes.set(key, { source, analyser, trackId: track.id });
  }

  // 0〜1 の目安（-60dBFS〜0dBFS を線形に割り当て）
  read(): Record<string, number> {
    const levels: Record<string, number> = {};
    for (const [key, { analyser }] of this.nodes) {
      analyser.getFloatTimeDomainData(this.buffer);
      let sum = 0;
      for (const value of this.buffer) sum += value * value;
      const rms = Math.sqrt(sum / this.buffer.length);
      const db = 20 * Math.log10(rms || 1e-8);
      levels[key] = Math.max(0, Math.min(1, (db + 60) / 60));
    }
    return levels;
  }

  close() {
    this.removeGestureListeners?.();
    this.removeGestureListeners = null;
    for (const { source } of this.nodes.values()) source.disconnect();
    this.nodes.clear();
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
