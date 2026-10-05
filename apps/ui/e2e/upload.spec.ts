import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, expect, test, type Page } from "@playwright/test";
import { buildConversation, CONVERSATION, writeMixedConversation } from "./conversation";

// ファイルアップロード経路の文字起こし（#166）。
// 台本の会話を 1 本の m4a に混ぜてアップロードし、音声認識の時刻と、Gemini が推定した話者を確かめる。
// 話者名は声だけでは決まらないので、「同じ人の台詞には同じ名前、別の人には別の名前」になっているかを見る。
//
//   E2E_BASE_URL / E2E_AUTH（mock | guest）は recording.spec.ts と同じ。macOS の say と ffmpeg が要る。

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3002";
const CAST = "小野、数森、高島";

// 番組設定の画面から、選択中のチャンネルの ID を読む（保存の PATCH 先）
async function selectedPodcastId(page: Page): Promise<number> {
  await page.goto("/settings");
  const patched = page.waitForRequest((request) => request.method() === "PATCH" && /\/api\/podcasts\/\d+$/.test(request.url()));
  await page.getByRole("button", { name: "設定を保存" }).click();
  return Number((await patched).url().split("/").pop());
}

type Segment = { start: number; end: number; speaker: string; text: string };

function similarity(a: string, b: string): number {
  const normalize = (text: string) => text.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
  const grams = (value: string) =>
    new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, i) => value.slice(i, i + 2)));
  const left = grams(normalize(a));
  const right = grams(normalize(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

test("アップロードした会話が、話者と時刻つきで文字起こしされる", async () => {
  test.skip(process.env.E2E_UPLOAD !== "1", "E2E_UPLOAD=1 のときだけ実行する（dev の音声認識と Gemini を使う）");
  const conversation = buildConversation(3);
  const loops = 2;
  const file = writeMixedConversation(conversation, loops, path.join(__dirname, ".audio", "conversation.m4a"));

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const login =
      (process.env.E2E_AUTH ?? "mock") === "guest"
        ? await context.request.post("/api/auth/guest-session")
        : await context.request.post("/api/auth/mock-session", { data: { email: process.env.E2E_MOCK_EMAIL ?? "dev@example.com" } });
    expect(login.ok()).toBeTruthy();
    const page = await context.newPage();

    // 番組設定で登場人物を保存し、読み直しても残っていること
    await page.goto("/settings");
    await page.getByLabel("登場人物").fill(CAST);
    await page.getByRole("button", { name: "設定を保存" }).click();
    await expect(page.getByText("設定を更新しました")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("登場人物")).toHaveValue(CAST);

    // アップロード。PR プレビューのオリジンは入力バケットの CORS に無い（PR ごとに変わるため登録できない）ので、
    // 画面と同じ API（upload-url → 署名付き URL に PUT → upload-result）をテストから直接呼ぶ。
    const bytes = readFileSync(file);
    const createdResponse = await context.request.post("/api/episodes/upload-url", {
      data: {
        podcastId: await selectedPodcastId(page),
        fileName: "conversation.m4a",
        contentType: "audio/mp4",
        fileSize: bytes.length,
      },
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const { episodeId, uploadUrl } = (await createdResponse.json()) as { episodeId: number; uploadUrl: string };
    const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "audio/mp4" }, body: bytes });
    expect(put.ok, `PUT ${put.status}`).toBeTruthy();
    await context.request.post(`/api/episodes/${episodeId}/upload-result`, { data: { status: "uploaded" } });
    console.log(`episode: ${episodeId}`);

    await expect
      .poll(
        async () => {
          const response = await context.request.get(`/api/episodes/${episodeId}`);
          const body = (await response.json()) as { episode?: { status: string }; status?: string };
          return (body.episode ?? body).status;
        },
        { timeout: 20 * 60_000, intervals: [15_000] },
      )
      .toBe("completed");

    const response = await context.request.get(`/api/episodes/${episodeId}/transcript`);
    const { segments } = (await response.json()) as { segments: Segment[] };
    for (const segment of segments) {
      console.log(`  [${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.speaker}: ${segment.text}`);
    }

    // 台詞ごとに最も似た発話を探し、時刻と話者を確かめる（ループの 1 周目だけで見る）
    const labels = new Map<number, Set<string>>();
    const errors: number[] = [];
    for (const line of conversation.timeline) {
      const best = segments
        .filter((segment) => segment.start < conversation.durationSeconds)
        .map((segment) => ({ segment, score: similarity(segment.text, line.text) }))
        .sort((a, b) => b.score - a.score)[0];
      if (!best || best.score < 0.5) continue;
      errors.push(Math.abs(best.segment.start - line.start));
      labels.set(line.speaker, (labels.get(line.speaker) ?? new Set()).add(best.segment.speaker));
    }
    const sorted = [...errors].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? Infinity;
    console.log(`matched ${errors.length}/${CONVERSATION.length}, time error median ${median.toFixed(2)}s`);
    console.log(`labels by script speaker: ${JSON.stringify([...labels].map(([k, v]) => [k, [...v]]))}`);

    expect(errors.length).toBeGreaterThanOrEqual(Math.ceil(CONVERSATION.length * 0.7));
    expect(median).toBeLessThan(1.0);
    // 同じ人の台詞には同じ名前（推定のぶれは 1 人まで許す）、別の人には別の名前
    const primary = [...labels.values()].map((set) => [...set][0]);
    expect(new Set(primary).size, "different speakers get different labels").toBe(labels.size);
    const inconsistent = [...labels.values()].filter((set) => set.size > 1).length;
    expect(inconsistent, "speakers with mixed labels").toBeLessThanOrEqual(1);
  } finally {
    await browser.close();
  }
});
