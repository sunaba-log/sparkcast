# ブラウザ収録ルームの運用（#166）

構成と設計判断は [ADR](../adr/20261004-browser-recording-room.md) を参照。

## 構成要素と置き場所

| 要素 | 場所 | 管理 |
| --- | --- | --- |
| 画面・API・トークン発行 | `apps/ui`（`/record`・`/join`・`/api/recording/*`） | CD（ui ジョブ） |
| ルーム（Durable Object）・SFU プロキシ・チャンクの受け口 | `apps/realtime`（`sparkcast-realtime-{env}.sunabalog.com`） | CD（realtime ジョブ、wrangler） |
| ミックス | `apps/automator/app/src/mixer_main.py`（Cloud Run Job `sparkcast-automator-mixer-{env}`） | Terraform（`infra/recording.tf`） |
| 録音の保存 | R2 `sparkcast-recordings-{env}`（`sessions/` は 30 日で削除） | Terraform |
| Realtime SFU / TURN アプリ | Cloudflare（`sparkcast-recording-{env}`） | Terraform（restapi provider。下記） |
| 秘密 | Secret Manager: `sparkcast-recording-room-secret`・`sparkcast-recording-service-secret`（UI、値も Terraform）、`sparkcast-recording-worker-secrets`（Worker 用 JSON、値も Terraform） | Terraform |
| DB | `recording_sessions`・`recording_participants`・`recording_tracks`（`apps/ui/migrations/008_*`） | CD（マイグレーション） |

## Cloudflare API トークンに要る権限

Terraform（`CLOUDFLARE_API_TOKEN`）と CD の wrangler は同じトークンを使う。既存の権限（DNS・R2）に加えて、次の権限が要る。

- Account › **Realtime（Calls）: Edit** … SFU と TURN のアプリを作る
- Account › **Workers Scripts: Edit** … Worker と Durable Object をデプロイする
- Account › **Workers R2 Storage: Edit** … recordings バケットとライフサイクル（既存にあれば不要）
- Zone（sunabalog.com）› **Workers Routes: Edit** … Custom Domain（`sparkcast-realtime-dev.sunabalog.com`）を設定する
- Account › **Account Settings: Read** … wrangler がアカウントの情報を読むのに使う

変えたら、ローカルの `.env` と GitHub Secrets の `CLOUDFLARE_API_TOKEN` の両方を更新する。

mixer は既存の R2 キー（Secret Manager の `cloudflare-access-key-id` / `cloudflare-secret-access-key`）を使う。このキーが特定のバケットに限定されている場合は、`sparkcast-recordings-{env}` にも読み書きできるようにする。

## Realtime アプリと Worker 用の秘密（Terraform）

Realtime の SFU アプリと TURN の鍵は、`infra/recording.tf` の `restapi_object`（Mastercard/restapi provider）で作る。
cloudflare provider の `cloudflare_calls_sfu_app` / `cloudflare_calls_turn_app` は、v5.26 でも作成後の refresh が
`missing required app_id / key_id parameter` で失敗し、TURN の鍵の値も取れないため使わない。

- 値（SFU のトークン・TURN の鍵）は作成時の応答にしか無いので、Terraform が `create_response` から読み、
  `sparkcast-recording-worker-secrets`（Worker 用の JSON）に書く。ROOM_SECRET / SERVICE_SECRET も Terraform が同じ値で入れる。
- restapi provider には `TF_VAR_cloudflare_api_token`（`CLOUDFLARE_API_TOKEN` と同じ値）が要る。CD は `.env` に入れている。
  手元から plan / apply するときは、ルートの `.env` に `TF_VAR_cloudflare_api_token=...` を足す。
- 作り直したいとき（漏えいなど）は `terraform apply -replace='restapi_object.realtime_sfu_app[0]'` のように置き換え、
  そのあと Worker の secret を入れ直す（下）。
- Worker の secret は、realtime の CD（push 時）が Secret Manager の JSON を `wrangler secret bulk` で入れる。
  feature ブランチで dev に入れるときは、下の「dev への反映」の 2 の手順で入れる。

## dev への反映（初回）

1. `make terraform-deploy-dev`
   - R2 バケット、SFU/TURN アプリ、Secret、mixer Job、IAM、UI の環境変数を作る。
   - UI の環境変数を足す apply の間だけ、`infra/ui_cloud_run.tf` の `template[0].revision` の ignore を外す（外さないと 409）。反映後は戻す（戻さないと、infra を apply するたびに UI のリビジョンが新しく作られる）。dev はこの手順で反映済み。prod を有効にするときも同じ手順が要る。
2. Worker をデプロイする（以降の変更は CD が行う）。

   ```bash
   cd apps/realtime
   npx wrangler deploy --env dev
   gcloud secrets versions access latest --secret=sparkcast-recording-worker-secrets --project=sunabalog-dev > /tmp/worker-secrets.json
   npx wrangler secret bulk /tmp/worker-secrets.json --env dev && rm /tmp/worker-secrets.json
   ```

3. UI は PR プレビュー（develop 宛ての PR）か、develop へのマージ後の CD で反映する。
   - PR プレビューのオリジンは、Worker の `ALLOWED_ORIGIN_PATTERN` で許可している。

## 動作確認

- `curl https://sparkcast-realtime-dev.sunabalog.com/health` が `{"ok":true}` を返すこと。
- E2E は `apps/ui/e2e/`（Playwright）にある。Chromium を 3 つ起動し、偽のマイク音声で参加 → 収録 → エピソード化まで流す。詳しくは `apps/ui/e2e/README.md` を参照。

## 障害時

| 症状 | 見るところ |
| --- | --- |
| 入室できない・通話がつながらない | Worker のログ（`npx wrangler tail --env dev`）、ブラウザのコンソール（partytracks の履歴） |
| 録音が届かない | ルーム画面の「未送信 n 件」と Worker のログ。ゲストの端末には IndexedDB に録音が残っており、同じ招待 URL を開き直すと送信が再開する |
| ミックスが失敗した | Cloud Run Job `sparkcast-automator-mixer-dev` の実行ログ、Discord のエラー通知、`recording_sessions.error` |
| ミックスが止まった | 3 時間たっても終わらないものは、cron（`/api/cron/cleanup-uploads`）が `failed` にする |
| ルームの期限（作成から 6 時間）が過ぎた | ルームの画面や一覧を開いたとき（と 1 日 1 回の cron）に、収録を始めていないルームは `expired`、収録中のまま放置されたルームは `uploading`（停止済み）にする。`uploading` は残るので、ホストがルームの画面を開けば、入室せずに「エピソード化する」を押せる（R2 の録音が 30 日で消えるまで） |

- ミックスのやり直しは、Job を同じ env の上書きで再実行する。出力先の FLAC が既にあるときは上書きしない。
- 出力先の FLAC が既にあり、もう一度パイプラインに流したいときは、GCS の当該オブジェクトを消してから再実行する。

## コストの監視

- **Realtime SFU / TURN**: 月 1TB まで無料、超過は $0.05/GB。4 人で 1 時間の会話は約 0.15〜0.3GB の見込み。Cloudflare ダッシュボードの Realtime → Analytics で確認する。
- **Workers / Durable Objects**（Free）: 1 日 10 万リクエスト。超えると失敗する（課金はされない）。録音チャンクの送信は 1 人あたり 6 回/分。
- **R2**: 保存は月 10GB まで無料。録音は 30 日で消える。
- 使用量の通知は、Cloudflare の Billing → Notifications で設定する。GCP の予算アラート（`infra/budget.tf`）には含まれない。

## prod の有効化（電気通信事業の届出が済んでから）

1. `infra/environments/prod/variables.tfvars` に `enable_recording = true` と `realtime_hostname = "sparkcast-realtime.sunabalog.com"` を書く。
2. リポジトリ変数 `RECORDING_PROD_ENABLED=true` を設定する（CD が prod に Worker を出すようになる）。
3. プライバシーポリシーに、音声の取得と利用目的を書き足す。
