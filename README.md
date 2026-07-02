# podcast-ui

Podcaster's DevLogのdev環境向け管理Webアプリです。Next.jsのUIとWeb APIを
同一リポジトリで提供します。

## 機能

- Firebase AuthenticationによるGoogleログインとユーザ登録
- チャンネル（Podcast）の作成・一覧・切り替え
- Cloud SQLのPodcast所有権確認
- エピソード作成とGCS V4署名付きURL発行
- ブラウザからGCSへの音声ファイル直接アップロード
- Cloud SQLの処理状態を使ったエピソード一覧・詳細表示
- Firestoreの議事録、X投稿候補、収録アジェンダの閲覧・編集
- 配信済み議事録を横断するRAGチャット（Vertex AI Gemini + Firestoreベクトル検索）
- アップロード結果通知と放置アップロードの定期クリーンアップ

## データ構成

- Cloud SQL PostgreSQL: users、podcasts、podcast_ownerships、episodes
- Firestore: 議事録、AIメタデータ、SNS投稿候補、収録アジェンダ
- GCS: Automatorが処理する入力音声ファイル

ブラウザはCloud SQLとFirestoreへ直接接続しません。データ操作はNext.js API
またはServer Component経由で行います。

## セットアップ

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

`db:migrate`は`migrations/*.sql`をファイル名順に適用し、
`schema_migrations`へ履歴を記録します。`DATABASE_URL`またはCloud SQL Connector用の
環境変数を利用できます。

`.env.local`にはSecretが含まれるため、ファイル自体は共有しません。必要なキーと
取得元は`docs/runbooks/environment-variables.md`を参照してください。

## 認証

Googleアカウントでログインできます。`DEV_ALLOWED_EMAILS`を設定した場合は指定された
ユーザーだけに制限されます（未設定・空なら全アカウント許可）。初回ログイン後は
`/register`で表示名を確認してユーザ登録します（暗黙の自動登録・owner自動付与は行いません）。

登録後は`/channels`でチャンネル（Podcast）を作成・一覧・切り替えできます。作成者には
owner権限が付与され、選択中チャンネルはCookie（`selected_podcast_id`）に保持されます。
各画面・APIは選択中チャンネルを対象に動作します。

### ローカル開発時のモック認証

ローカル環境（`localhost`）での開発時にGoogle認証をスキップし、ワンクリックでログイン状態を再現するためのモック認証機能を利用できます。

1. `.env.local` に `NEXT_PUBLIC_ENABLE_LOCAL_MOCK_AUTH="true"` を設定します。
2. `npm run dev` で起動後、ログイン画面（`/login`）に「開発用ワンクリックログイン」ボタンが表示されます。
3. ボタンをクリックすると、`DEV_ALLOWED_EMAILS` に設定されたメールアドレス（デフォルト: `admin@sunabalog.com`）でFirebase認証なしで即座にログインできます。未登録の場合は通常のログインと同様に`/register`からユーザ登録します。

VercelなどGoogle Cloud外で動かす場合、`FIREBASE_SERVICE_ACCOUNT_JSON`へ
Firestore、Firebase Auth、GCS署名に使用するサービスアカウントJSONを設定します。

## GCS ID契約

```text
podcasts/{podcast_id}/episodes/{episode_id}/source/{filename}
```

`podcast-automator`はこのパスからCloud SQLのIDを取得します。詳細は
`docs/contracts/episode-upload.md`を参照してください。

## アップロード状態

```text
upload_pending -> uploaded -> processing -> completed
                                      \-> failed
```

ブラウザから結果通知が届かない`upload_pending`レコードは、Vercel Cronによって
24時間後に`failed`へ更新されます。HobbyプランのCron制約に合わせ、1日1回実行します。

## 議事録チャット（RAG）

全ページ右下のアイコンから、配信済みエピソードの議事録を横断して質問できる。
回答生成はVertex AIのGemini、横断検索はFirestoreのベクトル検索を使う。認証は
`FIREBASE_SERVICE_ACCOUNT_JSON`と`GOOGLE_CLOUD_PROJECT`を流用する。

利用前にFirestoreのベクトルインデックスをVertex AIの埋め込み次元(768)で作成する。

```bash
gcloud firestore indexes composite create \
  --project="$GOOGLE_CLOUD_PROJECT" \
  --collection-group=minutes_index \
  --query-scope=COLLECTION \
  --field-config=field-path=embedding,vector-config='{"dimension":768,"flat":{}}'
```

議事録のベクトル化は**Vercel Cronで日次自動実行**する（`/api/cron/reindex-minutes`）。
冪等で、未変更のエピソードはスキップするため新規・変更分のみ埋め込む。即時に反映したい
場合はチャットウィンドウの「再インデックス」（`POST /api/chat/reindex`）を手動実行する。
インデックス未構築でも全文コンテキストへ自動フォールバックして回答する。設計詳細は
`docs/adr/20260628-podcast-minutes-chat.md`を参照。

## 検証

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
```
