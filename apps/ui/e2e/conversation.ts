import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

// 音声合成（macOS の say）で、台本どおりに 3 人が順番に話す会話を作る（#166 の文字起こしの検証用）。
// 参加者ごとに「自分の台詞の区間だけ声があり、ほかは無音」のトラックを作るので、
// 偽マイクを全員同じ時刻基準で鳴らせば、実際に会話しているのと同じ並びになる。

export type ScriptLine = { speaker: number; text: string };

export const CONVERSATION: ScriptLine[] = [
  { speaker: 0, text: "こんにちは、今日も収録を始めます。今回のテーマはブラウザでの収録です。" },
  { speaker: 1, text: "よろしくお願いします。アカウントなしで参加できるのは便利ですね。" },
  { speaker: 2, text: "私もリンクを開くだけで入れました。音も綺麗に聞こえています。" },
  { speaker: 0, text: "録音はそれぞれの端末で行って、あとで自動的にミックスされます。" },
  { speaker: 1, text: "途中で回線が切れても、録音は後から送り直されるんですよね。" },
  { speaker: 2, text: "それなら安心して話せます。次は文字起こしの話を聞きたいです。" },
  { speaker: 0, text: "文字起こしは話者ごとに作るので、誰が何秒に話したかが分かります。" },
  { speaker: 1, text: "議事録の目次の時刻も、実際の時刻になるのはありがたいです。" },
  { speaker: 2, text: "では今日はこのあたりで終わりにしましょう。ありがとうございました。" },
];

const VOICES = ["Kyoko", "Eddy (日本語（日本）)", "Flo (日本語（日本）)"];
export const VOICE_RATE = 16_000;
const GAP_SECONDS = 0.8;

export type Conversation = {
  // 参加者ごとの PCM（16bit・16kHz・モノラル）を base64 にしたもの
  tracks: string[];
  durationSeconds: number;
  // 台詞ごとの開始・終了（ループの先頭からの秒）
  timeline: (ScriptLine & { start: number; end: number })[];
};

function synthesize(text: string, voice: string, directory: string, index: number): Int16Array {
  const aiff = path.join(directory, `line-${index}.aiff`);
  const raw = path.join(directory, `line-${index}.raw`);
  execFileSync("say", ["-v", voice, "-o", aiff, text]);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", aiff, "-ac", "1", "-ar", String(VOICE_RATE), "-f", "s16le", raw]);
  const bytes = readFileSync(raw);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

export function buildConversation(speakers = 3): Conversation {
  const directory = path.join(__dirname, ".audio", "tts");
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });

  const clips = CONVERSATION.map((line, index) => synthesize(line.text, VOICES[line.speaker % VOICES.length], directory, index));
  const gap = Math.round(GAP_SECONDS * VOICE_RATE);
  const total = clips.reduce((sum, clip) => sum + clip.length + gap, gap);
  const tracks = Array.from({ length: speakers }, () => new Int16Array(total));
  const timeline: Conversation["timeline"] = [];
  let position = gap;
  CONVERSATION.forEach((line, index) => {
    tracks[line.speaker].set(clips[index], position);
    timeline.push({ ...line, start: position / VOICE_RATE, end: (position + clips[index].length) / VOICE_RATE });
    position += clips[index].length + gap;
  });
  return {
    tracks: tracks.map((track) => Buffer.from(track.buffer).toString("base64")),
    durationSeconds: total / VOICE_RATE,
    timeline,
  };
}
