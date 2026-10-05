import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Chromium の偽マイク（--use-file-for-fake-audio-capture）に渡す WAV を作る。
// 参加者ごとに声の高さ・話す区間を変え、ミックス後に誰の声か区別できるようにする。

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function speechLikeSamples(seconds: number, seed: number, sampleRate = 48_000): Float32Array {
  const next = random(seed);
  const samples = new Float32Array(Math.floor(seconds * sampleRate));
  const pitch = 110 + next() * 140;
  let position = 0;
  while (position < samples.length) {
    const talk = Math.floor((0.6 + next() * 2.4) * sampleRate);
    const pause = Math.floor((0.3 + next() * 1.2) * sampleRate);
    let noise = 0;
    for (let i = 0; i < talk && position + i < samples.length; i += 1) {
      const t = (position + i) / sampleRate;
      // 声の帯域のノイズ（1 次の低域通過）と基本周波数＋倍音
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

export function encodeWav(samples: Float32Array, sampleRate = 48_000): Buffer {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(value < 0 ? value * 0x8000 : value * 0x7fff), 44 + i * 2);
  }
  return buffer;
}

export function writeFakeVoices(count: number, seconds = 120): string[] {
  const directory = path.join(__dirname, ".audio");
  mkdirSync(directory, { recursive: true });
  return Array.from({ length: count }, (_, index) => {
    const file = path.join(directory, `voice-${index}.wav`);
    writeFileSync(file, encodeWav(speechLikeSamples(seconds, 1000 + index * 77)));
    return file;
  });
}
