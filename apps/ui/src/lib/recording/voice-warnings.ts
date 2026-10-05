// 収録中の自分の声の警告（#166）。自動ゲインを切っているので、割れた音はそのまま録られ、
// ミュートのまま話した分は録れない。どちらも後から直せないので、その場で知らせる。

export type VoiceWarning = "clipping" | "muted-speech";

// ピークがここを超えたら割れとみなす（0dBFS 近く）
const CLIP_PEAK = 0.98;
// 直近 10 秒で 3 回割れたら警告する（1 回の大きな物音では出さない）
const CLIP_WINDOW_MS = 10_000;
const CLIP_COUNT = 3;
// メーターの値（-60〜0dBFS を 0〜1 にしたもの）がここを超えたら、話しているとみなす（約 -27dBFS）
const SPEECH_LEVEL = 0.55;
// ミュート中に、直近 5 秒のうち 1.5 秒以上話していたら警告する（会話は短い間が入るので窓を広めに取る）
const SPEECH_WINDOW_MS = 5_000;
const SPEECH_MS = 1_500;
// 一度出した警告は、しばらく出したままにする（ちらつかせない）
const HOLD_MS = 6_000;

export class VoiceWarnings {
  private clips: number[] = [];
  private speech: { at: number; ms: number }[] = [];
  private lastAt: number | null = null;
  private shown: { warning: VoiceWarning; until: number } | null = null;

  // メーターを読むたびに呼ぶ。出すべき警告を返す
  update(sample: { level: number; peak: number; muted: boolean }, now: number): VoiceWarning | null {
    const elapsed = this.lastAt === null ? 0 : Math.min(now - this.lastAt, 1_000);
    this.lastAt = now;

    if (sample.peak >= CLIP_PEAK && !sample.muted) this.clips.push(now);
    this.clips = this.clips.filter((at) => now - at <= CLIP_WINDOW_MS);

    if (sample.muted && sample.level >= SPEECH_LEVEL) this.speech.push({ at: now, ms: elapsed });
    if (!sample.muted) this.speech = [];
    this.speech = this.speech.filter((item) => now - item.at <= SPEECH_WINDOW_MS);
    const speakingMs = this.speech.reduce((sum, item) => sum + item.ms, 0);

    if (sample.muted && speakingMs >= SPEECH_MS) {
      this.shown = { warning: "muted-speech", until: now + HOLD_MS };
    } else if (this.clips.length >= CLIP_COUNT) {
      this.shown = { warning: "clipping", until: now + HOLD_MS };
    }
    if (this.shown && (now > this.shown.until || (this.shown.warning === "muted-speech" && !sample.muted))) {
      this.shown = null;
    }
    return this.shown?.warning ?? null;
  }
}
