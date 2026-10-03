// ページ内で合成した声をマイクとして返す（getUserMedia の差し替え）。
//
// Chromium の --use-fake-device-for-media-stream は macOS の Playwright で getUserMedia が返ってこないことがある。
// そこで AudioContext で声っぽい信号を鳴らし、MediaStreamDestination のトラックをマイクの代わりに渡す。
// 参加者ごとに seed を変えて別の声にする。この関数は addInitScript でページに注入されるので、外の変数を参照しないこと。
export function installFakeMic({ seed, seconds }: { seed: number; seconds: number }) {
  type State = { context: AudioContext; destination: MediaStreamAudioDestinationNode };
  let state: State | null = null;

  function synthesize(sampleRate: number): Float32Array {
    let value = seed >>> 0;
    const next = () => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 0x1_0000_0000;
    };
    const samples = new Float32Array(Math.floor(seconds * sampleRate));
    const pitch = 110 + next() * 140;
    let position = 0;
    while (position < samples.length) {
      const talk = Math.floor((0.6 + next() * 2.4) * sampleRate);
      const pause = Math.floor((0.3 + next() * 1.2) * sampleRate);
      let noise = 0;
      for (let i = 0; i < talk && position + i < samples.length; i += 1) {
        const t = (position + i) / sampleRate;
        noise = noise * 0.85 + (next() * 2 - 1) * 0.15;
        const voiced =
          Math.sin(2 * Math.PI * pitch * t) * 0.5 +
          Math.sin(2 * Math.PI * pitch * 2 * t) * 0.25 +
          Math.sin(2 * Math.PI * pitch * 3 * t) * 0.12;
        const envelope = Math.min(1, i / 2400, (talk - i) / 2400);
        samples[position + i] = (voiced * 0.6 + noise * 2.5) * 0.25 * envelope;
      }
      position += talk + pause;
    }
    return samples;
  }

  async function ensure(): Promise<State> {
    if (!state) {
      const context = new AudioContext({ sampleRate: 48_000 });
      const buffer = context.createBuffer(1, Math.floor(seconds * context.sampleRate), context.sampleRate);
      buffer.copyToChannel(synthesize(context.sampleRate) as Float32Array<ArrayBuffer>, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      source.start();
      state = { context, destination };
    }
    if (state.context.state === "suspended") await state.context.resume();
    return state;
  }

  const devices = navigator.mediaDevices;
  if (!devices) return;
  const original = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    if (!constraints?.audio || constraints.video) return original(constraints);
    const { destination } = await ensure();
    return new MediaStream([destination.stream.getAudioTracks()[0].clone()]);
  };
  devices.enumerateDevices = async () =>
    [
      {
        deviceId: "e2e-fake-mic",
        groupId: "e2e",
        kind: "audioinput",
        label: "E2E Fake Mic",
        toJSON() {
          return this;
        },
      },
    ] as MediaDeviceInfo[];
}
