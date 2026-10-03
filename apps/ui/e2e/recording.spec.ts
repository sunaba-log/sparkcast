import { chromium, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { writeFakeVoices } from "./fake-audio";
import { installFakeMic } from "./fake-mic";

// 収録ルーム（#166）の E2E。
//
// ホスト 1 人＋ゲスト N 人を、それぞれ別の Chromium（別の偽マイク音声）で参加させ、
// 入室 → 通話 → 収録 → 停止 → 録音の送信 → エピソード化 までを通す。
//
// 環境変数:
//   E2E_BASE_URL        対象の UI（既定 http://localhost:3002）
//   E2E_AUTH            ホストのログイン方法: mock（ローカル）/ guest（dev のゲストモード）
//   E2E_MOCK_EMAIL      mock のときのメール（既定 dev@example.com）
//   E2E_GUESTS          ゲストの人数（既定 2）
//   E2E_RECORD_SECONDS  収録する秒数（既定 45）
//   E2E_SCENARIOS       収録中に起こすこと（カンマ区切り）: reload（ゲスト 1 がリロード）/ offline（ゲスト 2 が 20 秒回線断）
//   E2E_EXPECT          どこまで確かめるか: tracks（録音が届いたまで）/ mix（ミックス完了）/ episode（エピソード完成）
//   E2E_EXPECT_CALL     1 なら通話（SFU）がつながり、ホストの予備録音が届くことも確かめる
//   E2E_FAKE_MIC        stub（既定。ページ内で合成した声）/ flag（Chromium の偽マイク。Linux 向け）

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3002";
const GUESTS = Number(process.env.E2E_GUESTS ?? "2");
const RECORD_SECONDS = Number(process.env.E2E_RECORD_SECONDS ?? "45");
const SCENARIOS = new Set((process.env.E2E_SCENARIOS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const EXPECT = process.env.E2E_EXPECT ?? "tracks";
const EXPECT_CALL = process.env.E2E_EXPECT_CALL === "1";
const FAKE_MIC = process.env.E2E_FAKE_MIC ?? "stub";

type Participant = { browser: Browser; context: BrowserContext; page: Page; name: string };

type SessionView = {
  status: string;
  episodeId: number | null;
  episodeStatus: string | null;
  error: string | null;
  participants: { participantId: string; displayName: string; role: string }[];
  tracks: { participantId: string; kind: string; chunkCount: number; segmentCount: number; totalBytes: number; downloadable: boolean }[];
};

async function launch(audioFile: string): Promise<Browser> {
  const args = ["--autoplay-policy=no-user-gesture-required"];
  if (FAKE_MIC === "flag") {
    args.push(
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${audioFile}`,
    );
  }
  return chromium.launch({ args });
}

async function newParticipant(audioFile: string, name: string, seed: number): Promise<Participant> {
  const browser = await launch(audioFile);
  const context = await browser.newContext({ baseURL: BASE_URL, permissions: ["microphone"] });
  if (FAKE_MIC === "stub") await context.addInitScript(installFakeMic, { seed, seconds: 120 });
  const page = await context.newPage();
  page.on("response", (response) => {
    if (response.status() >= 400) {
      const url = new URL(response.url());
      console.log(`[${name}] ${response.status()} ${response.request().method()} ${url.origin}${url.pathname}`);
    }
  });
  page.on("dialog", (dialog) => void dialog.accept());
  return { browser, context, page, name };
}

async function loginHost(host: Participant) {
  const mode = process.env.E2E_AUTH ?? "mock";
  const response =
    mode === "guest"
      ? await host.context.request.post("/api/auth/guest-session")
      : await host.context.request.post("/api/auth/mock-session", {
          data: { email: process.env.E2E_MOCK_EMAIL ?? "dev@example.com" },
        });
  expect(response.ok(), `login (${mode}) failed: ${response.status()}`).toBeTruthy();
}

async function enterRoom(participant: Participant, options: { name?: string; consent?: boolean }) {
  const { page } = participant;
  if (options.name !== undefined) {
    await page.getByLabel("表示名").fill(options.name);
  }
  if (options.consent) {
    await page.getByRole("checkbox").check();
  }
  const join = page.getByRole("button", { name: "入室する" });
  await expect(join).toBeEnabled({ timeout: 30_000 });
  await join.click();
  await expect(page.getByText("（あなた）")).toBeVisible({ timeout: 30_000 });
}

async function sessionView(host: Participant, sessionId: string): Promise<SessionView> {
  const response = await host.context.request.get(`/api/recording/sessions/${sessionId}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as SessionView;
}

test("ホストとゲストが入室して収録し、録音が揃ってエピソード化できる", async () => {
  const voices = writeFakeVoices(GUESTS + 1);
  const host = await newParticipant(voices[0], "ホスト", 1000);
  const guests: Participant[] = [];
  try {
    await loginHost(host);

    // ルームを作る
    await host.page.goto("/record");
    await host.page.getByLabel("タイトル（任意）").fill(`E2E ${new Date().toISOString()}`);
    await host.page.getByRole("button", { name: "収録ルームを作成" }).click();
    await host.page.waitForURL(/\/record\/[0-9a-f-]{36}$/);
    const sessionId = host.page.url().split("/").pop()!;
    console.log(`session: ${sessionId}`);

    await enterRoom(host, {});
    const inviteUrl = await host.page.locator("input[readonly]").inputValue();
    expect(inviteUrl).toContain(`/join/${sessionId}?k=`);

    // ゲストが招待 URL から入る（ログイン不要）
    for (let index = 0; index < GUESTS; index += 1) {
      const guest = await newParticipant(voices[index + 1], `ゲスト${index + 1}`, 1000 + (index + 1) * 77);
      guests.push(guest);
      await guest.page.goto(inviteUrl);
      await enterRoom(guest, { name: guest.name, consent: true });
    }
    for (const guest of guests) {
      await expect(host.page.getByText(guest.name, { exact: true })).toBeVisible();
    }
    if (EXPECT_CALL) {
      await expect(host.page.getByText("通話: 接続")).toBeVisible({ timeout: 60_000 });
      for (const guest of guests) await expect(guest.page.getByText("通話: 接続")).toBeVisible({ timeout: 60_000 });
    }

    // 収録
    await host.page.getByRole("button", { name: "収録を開始" }).click();
    await expect(host.page.getByText("収録中", { exact: true })).toBeVisible();
    for (const guest of guests) await expect(guest.page.getByText("収録中", { exact: true })).toBeVisible();

    const half = Math.floor((RECORD_SECONDS * 1000) / 2);
    await host.page.waitForTimeout(half);
    if (SCENARIOS.has("reload") && guests[0]) {
      console.log("scenario: guest 1 reloads");
      await guests[0].page.reload();
      await expect(guests[0].page.getByLabel("表示名")).toHaveValue(guests[0].name, { timeout: 30_000 });
      await enterRoom(guests[0], { consent: true });
    }
    if (SCENARIOS.has("offline") && guests[1]) {
      console.log("scenario: guest 2 goes offline for 20s");
      await guests[1].context.setOffline(true);
      await host.page.waitForTimeout(20_000);
      await guests[1].context.setOffline(false);
    }
    await host.page.waitForTimeout(half);

    await host.page.getByRole("button", { name: "収録を停止" }).click();
    await expect(host.page.getByText("収録終了")).toBeVisible();

    // 全員の録音が届くのを待つ
    await expect(host.page.getByText("全員の録音が届きました。エピソード化できます。")).toBeVisible({
      timeout: 5 * 60_000,
    });
    for (const guest of guests) {
      await expect(guest.page.getByText("録音の送信が終わりました")).toBeVisible({ timeout: 60_000 });
    }

    // エピソード化
    await host.page.getByRole("button", { name: "エピソード化する" }).click();
    const finalizeError = host.page.locator("p.text-red-600");
    await Promise.race([
      host.page.getByText(/ミックスしています|エピソードを作成しています|エピソードができました/).waitFor({ timeout: 60_000 }),
      finalizeError.waitFor({ timeout: 60_000 }).then(async () => {
        console.log(`finalize error: ${await finalizeError.textContent()}`);
      }),
    ]);

    const view = await sessionView(host, sessionId);
    console.log(JSON.stringify(view.tracks, null, 2));
    const everyone = view.participants.filter((participant) => participant.displayName);
    expect(everyone).toHaveLength(GUESTS + 1);
    for (const participant of everyone) {
      const local = view.tracks.find((track) => track.participantId === participant.participantId && track.kind === "local");
      expect(local?.chunkCount, `${participant.displayName} local chunks`).toBeGreaterThan(Math.floor(RECORD_SECONDS / 10) - 2);
    }
    if (SCENARIOS.has("reload")) {
      const reloaded = view.participants.find((participant) => participant.displayName === guests[0].name)!;
      const local = view.tracks.find((track) => track.participantId === reloaded.participantId && track.kind === "local")!;
      expect(local.segmentCount, "reload starts a new segment for the same participant").toBeGreaterThanOrEqual(2);
    }
    if (EXPECT_CALL) {
      for (const guest of view.participants.filter((participant) => participant.role === "guest")) {
        const backup = view.tracks.find((track) => track.participantId === guest.participantId && track.kind === "backup");
        expect(backup?.chunkCount, `${guest.displayName} backup chunks`).toBeGreaterThan(0);
      }
    }

    if (EXPECT === "mix" || EXPECT === "episode") {
      await expect
        .poll(async () => (await sessionView(host, sessionId)).status, { timeout: 15 * 60_000, intervals: [10_000] })
        .toBe("done");
      const done = await sessionView(host, sessionId);
      expect(done.tracks.filter((track) => track.downloadable).length).toBe(GUESTS + 1);
    }
    if (EXPECT === "episode") {
      await expect
        .poll(async () => (await sessionView(host, sessionId)).episodeStatus, { timeout: 30 * 60_000, intervals: [15_000] })
        .toBe("completed");
    }
  } finally {
    for (const participant of [host, ...guests]) await participant.browser.close().catch(() => undefined);
  }
});
