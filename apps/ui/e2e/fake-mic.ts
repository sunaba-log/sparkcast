// ページ内で合成した声をマイクとして返す（getUserMedia の差し替え）。
//
// Chromium の --use-fake-device-for-media-stream は macOS の Playwright で getUserMedia が返ってこないことがある。
// そこで AudioContext で声っぽい信号を鳴らし、MediaStreamDestination のトラックをマイクの代わりに渡す。
// 参加者ごとに seed を変えて別の声にする。この関数は addInitScript でページに注入されるので、外の変数を参照しないこと。
//
// pcm16（16bit PCM の base64）を渡すと、合成音の代わりにそれを鳴らす（音声合成した台本の会話）。
// epochMs を渡すと、全員が同じ時刻基準でループの同じ位置を鳴らす（別々のブラウザでも会話の順番が揃う）。
export function installFakeMic({
  seed,
  seconds,
  pcm16,
  rate,
  epochMs,
}: {
  seed: number;
  seconds: number;
  pcm16?: string;
  rate?: number;
  epochMs?: number;
}) {
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

  function decodePcm16(base64: string): Float32Array {
    const binary = atob(base64);
    const samples = new Float32Array(binary.length / 2);
    for (let i = 0; i < samples.length; i += 1) {
      const value = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
      samples[i] = (value >= 0x8000 ? value - 0x10000 : value) / 0x8000;
    }
    return samples;
  }

  async function ensure(): Promise<State> {
    if (!state) {
      const context = new AudioContext({ sampleRate: 48_000 });
      const bufferRate = pcm16 && rate ? rate : context.sampleRate;
      const samples = pcm16 ? decodePcm16(pcm16) : synthesize(context.sampleRate);
      const buffer = context.createBuffer(1, samples.length, bufferRate);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      const length = samples.length / bufferRate;
      const offset = epochMs === undefined ? 0 : (((Date.now() - epochMs) / 1000) % length + length) % length;
      source.start(0, offset);
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
