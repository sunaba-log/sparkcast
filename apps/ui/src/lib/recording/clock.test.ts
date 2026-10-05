import { describe, expect, it } from "vitest";
import { ClockSync } from "@/lib/recording/clock";

describe("ClockSync", () => {
  it("uses the sample with the smallest round trip", () => {
    const clock = new ClockSync();
    // 端末時計がサーバーより 500ms 遅れている。片道遅延が非対称な遅いサンプルを混ぜる
    clock.addSample({ t0: 1000, t1: 1400, serverTime: 1000 + 500 + 300 });
    clock.addSample({ t0: 2000, t1: 2020, serverTime: 2000 + 500 + 10 });
    clock.addSample({ t0: 3000, t1: 3200, serverTime: 3000 + 500 + 20 });
    expect(clock.offsetMs).toBe(500);
    expect(clock.bestRttMs).toBe(20);
    expect(clock.serverNow(10_000)).toBe(10_500);
  });

  it("ignores impossible samples and keeps a bounded window", () => {
    const clock = new ClockSync(2);
    clock.addSample({ t0: 10, t1: 5, serverTime: 0 });
    expect(clock.offsetMs).toBeNull();
    clock.addSample({ t0: 0, t1: 10, serverTime: 105 });
    clock.addSample({ t0: 100, t1: 140, serverTime: 220 });
    clock.addSample({ t0: 200, t1: 230, serverTime: 315 });
    expect(clock.sampleCount).toBe(2);
    expect(clock.offsetMs).toBe(100);
  });
});
