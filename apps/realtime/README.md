# sparkcast-realtime

ブラウザ収録ルーム（[#166](https://github.com/sunaba-log/sparkcast/issues/166)）の Cloudflare Worker。

- **Durable Object `Room`**（ルーム 1 つ = 1 インスタンス、SQLite）: 在室・SFU トラックの配布・収録の開始/停止・時刻同期（ping/pong）・録音チャンクの台帳。WebSocket は Hibernation API。
- **Realtime SFU のプロキシ**（`/rooms/:sid/sfu/*`）: ブラウザの partytracks が呼ぶ。SFU のアプリトークンはここでだけ付け、参加者は自分が作った SFU セッションしか操作できない。
- **録音チャンクの受け口**（`PUT /rooms/:sid/chunks`）: room JWT から参加者を決め、R2（`sparkcast-recordings-{env}`）の `sessions/{sid}/{local|backup}/{participantId}/{segment}/{seq}.webm` に保存する。
- **UI 向けの内部 API**（service JWT）: `control` / `kick` / `close` / `manifest`、署名付き URL での `files` ダウンロード。

トークンの発行は apps/ui（`src/server/recording/tokens.ts`）。形式を変えるときは両方のテストの固定ベクタを揃える。

## 開発

```bash
npm ci
npm test          # vitest（workerd 上で Durable Object・R2 ごと動かす）
npm run typecheck
npx wrangler dev  # ローカル。secret は .dev.vars に書く
```

`.dev.vars` の例:

```
ROOM_SECRET=...
SERVICE_SECRET=...
SFU_APP_ID=...
SFU_APP_TOKEN=...
TURN_KEY_ID=...
TURN_KEY_TOKEN=...
```

## デプロイ

`npx wrangler deploy --env dev`（`sparkcast-realtime-dev.sunabalog.com`）。secret は GCP Secret Manager の値を CD が `wrangler secret bulk` で入れる。
prod（`--env prod`、`sparkcast-realtime.sunabalog.com`）は、リポジトリ変数 `RECORDING_PROD_ENABLED=true` のときだけ CD が出す。使えるのは admin と許可したユーザーだけ（#174）。
