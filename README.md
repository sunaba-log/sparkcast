# podcast-ui

Podcaster's DevLogのdev環境向け管理Webアプリです。Next.jsのUIとWeb APIを
同一リポジトリで提供します。

## 機能

- Firebase AuthenticationによるGoogleログイン
- Cloud SQLのPodcast所有権確認
- エピソード作成とGCS V4署名付きURL発行
- ブラウザからGCSへのMP3直接アップロード
- Cloud SQLの処理状態を使ったエピソード一覧・詳細表示
- Firestoreの議事録、X投稿候補、収録アジェンダの閲覧・編集
- アップロード結果通知と放置アップロードの定期クリーンアップ

## データ構成

- Cloud SQL PostgreSQL: users、podcasts、podcast_ownerships、episodes
- Firestore: 議事録、AIメタデータ、SNS投稿候補、収録アジェンダ
- GCS: Automatorが処理する入力MP3

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
`schema_migrations`へ履歴を記録します。

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

## 検証

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
```
