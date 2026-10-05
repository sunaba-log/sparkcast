# E2E（Playwright）

収録ルーム（#166）の通しテスト。ホスト 1 人とゲスト N 人を別々の Chromium で参加させ、入室 → 通話 → 収録 → 停止 → 録音の送信 → エピソード化 までを確かめる。

マイクは既定でページ内で合成した声に差し替える（`fake-mic.ts`）。macOS の Playwright では、Chromium の偽マイク（`--use-fake-device-for-media-stream`）で getUserMedia が返ってこないことがあるため。Linux では `E2E_FAKE_MIC=flag` で実際の getUserMedia の経路も通せる。

## ローカル

```bash
# apps/realtime: npx wrangler dev --port 8787（.dev.vars に秘密）
# apps/ui: npm run dev -- -p 3002（.env.local に RECORDING_* とモック認証）
E2E_RECORD_SECONDS=40 E2E_SCENARIOS=reload,offline npm run e2e
```

ローカルの Worker には実在する SFU アプリが無いので、通話はつながらない（録音と送信は確かめられる）。

## dev（PR プレビュー）

```bash
E2E_BASE_URL=https://pr-<n>---sparkcast-ui-dev-jztgcd4mia-an.a.run.app \
E2E_AUTH=guest E2E_EXPECT_CALL=1 E2E_EXPECT=episode \
E2E_RECORD_SECONDS=120 E2E_SCENARIOS=reload,offline npm run e2e
```

主な環境変数は `recording.spec.ts` の冒頭を参照。`E2E_EXPECT=episode` は既存パイプライン（文字起こし・議事録）まで待つので、dev の Gemini を使う。
