import { describe, expect, it } from "vitest";
import { VoiceWarnings } from "@/lib/recording/voice-warnings";

function feed(warnings: VoiceWarnings, samples: { level: number; peak: number; muted: boolean }, fromMs: number, toMs: number) {
  let result = null;
  for (let now = fromMs; now <= toMs; now += 120) result = warnings.update(samples, now);
  return result;
}

describe("VoiceWarnings", () => {
  it("warns about speaking while muted after a moment of speech", () => {
    const warnings = new VoiceWarnings();
    expect(feed(warnings, { level: 0.7, peak: 0.3, muted: true }, 0, 600)).toBeNull();
    expect(feed(warnings, { level: 0.7, peak: 0.3, muted: true }, 720, 2_000)).toBe("muted-speech");
    // ミュートを解いたら消える
    expect(warnings.update({ level: 0.7, peak: 0.3, muted: false }, 2_200)).toBeNull();
  });

  it("does not warn about quiet rooms while muted", () => {
    const warnings = new VoiceWarnings();
    expect(feed(warnings, { level: 0.2, peak: 0.05, muted: true }, 0, 10_000)).toBeNull();
  });

  it("warns about clipping only when it repeats", () => {
    const warnings = new VoiceWarnings();
    expect(warnings.update({ level: 0.9, peak: 1, muted: false }, 0)).toBeNull();
    expect(feed(warnings, { level: 0.6, peak: 0.5, muted: false }, 120, 3_000)).toBeNull();
    warnings.update({ level: 0.9, peak: 1, muted: false }, 3_100);
    expect(warnings.update({ level: 0.9, peak: 1, muted: false }, 3_200)).toBe("clipping");
    // 割れた直後は出したまま、しばらく割れなければ消える
    expect(feed(warnings, { level: 0.6, peak: 0.5, muted: false }, 3_300, 6_000)).toBe("clipping");
    expect(feed(warnings, { level: 0.6, peak: 0.5, muted: false }, 6_100, 20_000)).toBeNull();
  });
});
