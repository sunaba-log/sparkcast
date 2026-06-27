# podcast-ui

Podcaster's DevLogのdev環境向け管理Webアプリです。Next.jsのUIとWeb APIを
同一リポジトリで提供します。

## 機能

- Firebase AuthenticationによるGoogleログイン
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

## 認証

`DEV_ALLOWED_EMAILS`に指定されたユーザーだけがログインできます。初回ログイン時に
ユーザーをCloud SQLへ登録し、`DEFAULT_PODCAST_ID`のowner権限を付与します。
この自動付与は単一Podcastのdev環境専用です。

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

チャットウィンドウの「再インデックス」（`POST /api/chat/reindex`）で配信済み議事録を
ベクトル化する。議事録が未変更のエピソードはスキップする。インデックス未構築でも
全文コンテキストへ自動フォールバックして回答する。設計詳細は
`docs/adr/20260628-podcast-minutes-chat.md`を参照。

## 検証

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
```
