// サーバー（Durable Object）時刻との差を測る（#166）。
// ping の往復時間（RTT）が最小のサンプルほど誤差が小さいので、直近のサンプルのうち
// RTT 最小のものから offset を決める。端末の時計は Date.now() ではなく
// performance.timeOrigin + performance.now() を使う（NTP 補正で飛ばないため）。

export type ClockSample = { t0: number; t1: number; serverTime: number };

export function localNow(): number {
  return performance.timeOrigin + performance.now();
}

export class ClockSync {
  private samples: (ClockSample & { rtt: number })[] = [];

  constructor(private readonly maxSamples = 40) {}

  addSample(sample: ClockSample) {
    const rtt = sample.t1 - sample.t0;
    if (!Number.isFinite(rtt) || rtt < 0 || rtt > 10_000) return;
    this.samples.push({ ...sample, rtt });
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  // サーバー時刻 = 端末時刻 + offset
  get offsetMs(): number | null {
    const best = this.best();
    if (!best) return null;
    return best.serverTime - (best.t0 + best.rtt / 2);
  }

  get bestRttMs(): number | null {
    return this.best()?.rtt ?? null;
  }

  serverNow(local = localNow()): number {
    return local + (this.offsetMs ?? 0);
  }

  private best() {
    let best: (ClockSample & { rtt: number }) | null = null;
    for (const sample of this.samples) {
      if (!best || sample.rtt < best.rtt) best = sample;
    }
    return best;
  }
}
