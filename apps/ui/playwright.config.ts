import { defineConfig } from "@playwright/test";

// 収録ルーム（#166）の E2E。ブラウザは spec の中で参加者ごとに別プロセスで起動する
// （偽マイクの音声ファイルがブラウザ単位の起動引数のため）。
export default defineConfig({
  testDir: "./e2e",
  timeout: 30 * 60 * 1000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3002",
    trace: "retain-on-failure",
  },
});
