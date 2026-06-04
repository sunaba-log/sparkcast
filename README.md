# Podcast Automater — Frontend UI

ポッドキャスト制作・配信を自動化する管理ツールのフロントエンドリポジトリ。

---

## 1. プロジェクト概要

### Podcast Automater とは

mp3ファイルをアップロードするだけで、ポッドキャストの**文字起こし・議事録生成・X投稿文の自動生成・会話のタネ提案・各プラットフォームへの配信**までを自動化するツール。

### 解決したい課題

ポッドキャスト制作には収録後に多くの手作業が伴う。

- 議事録・要約の手書き
- SNS告知文の作成
- 次回収録ネタ探し
- Spotify / Apple Podcasts へのアップロード作業

これらをAIとバックエンド自動化でゼロにし、収録後5分以内に配信完了できる状態を目指す。

### 想定ユーザー

- 個人・小規模チームで運営しているポッドキャスター
- 収録本数が増えて運用コストを下げたい制作者
- 技術系・ビジネス系コンテンツのポッドキャスト運営者

---

## 2. 現在実装済み機能

> **注意：現在はすべてモックデータで動作しています。**  
> Firestore / Cloud Storage / バックエンドAPIとの接続は未実装です。

| 機能 | 状態 |
|---|---|
| エピソード一覧表示 | ✅ 実装済み（モック） |
| エピソード詳細表示 | ✅ 実装済み（モック） |
| mp3アップロードUI | ✅ 実装済み（仮動作のみ） |
| ステータスバッジ表示 | ✅ 実装済み |
| 議事録表示 | ✅ 実装済み（モック） |
| X投稿文リコメンド表示 | ✅ 実装済み（モック） |
| 会話のタネ表示 | ✅ 実装済み（モック） |
| コピーボタン | ✅ 実装済み |
| 認証 | ❌ 未実装 |
| Firestore接続 | ❌ 未実装 |
| 実際のmp3アップロード | ❌ 未実装 |
| RSS生成 | ❌ 未実装 |
| Spotify / Apple Podcasts連携 | ❌ 未実装 |

---

## 3. 画面構成

```
/upload            → mp3アップロード
    ↓
/                  → エピソード一覧
    ↓
/episodes/[id]     → エピソード詳細
```

### `/upload` — アップロード画面

mp3ファイルを選択してアップロードを開始する画面。将来的には Cloud Storage へのアップロード → バックエンドの自動処理パイプラインの起動につながる。

### `/` — エピソード一覧

全エピソードをカード形式で一覧表示。タイトル・作成日・ステータス・各コンテンツの生成済みフラグを一目で確認できる。

### `/episodes/[id]` — エピソード詳細

特定エピソードの全情報を表示。議事録・X投稿文リコメンド・会話のタネをカードで分けて表示し、各コンテンツにコピーボタンと再生成ボタンを配置。

---

## 4. 技術スタック

### フロントエンド

| 技術 | 用途 |
|---|---|
| Next.js (App Router) | フレームワーク |
| TypeScript | 型安全性 |
| Tailwind CSS v4 | スタイリング |
| Vercel | ホスティング・デプロイ |

### バックエンド（予定）

| 技術 | 用途 |
|---|---|
| Firestore | エピソードデータの永続化 |
| Cloud Storage | mp3ファイルの保存 |
| Cloud Functions | 処理パイプライン（文字起こし・生成AIとの連携） |

---

## 5. アーキテクチャ（予定）

```
ユーザー
  │
  │ mp3ファイルをアップロード
  ▼
Cloud Storage
  │
  │ アップロード完了イベント
  ▼
Cloud Functions（パイプライン）
  ├─ 文字起こし（Whisper / Speech-to-Text）
  │     ↓
  ├─ 議事録生成（LLM）
  │     ↓
  ├─ X投稿文リコメンド生成（podcast-promoter連携）
  │     ↓
  └─ 会話のタネ生成（過去議事録＋ニュース参照）
          ↓
       Firestore へ保存
          ↓
       UI が反映（リアルタイムまたはポーリング）
```

---

## 6. Firestoreデータモデル案

### `episodes` コレクション

```typescript
type EpisodeStatus = "uploaded" | "processing" | "completed" | "failed";

type Episode = {
  id: string;                        // ドキュメントID（自動採番）
  title: string;                     // エピソードタイトル
  createdAt: Timestamp;              // アップロード日時
  publishedAt?: Timestamp;           // 各プラットフォームへの公開日時

  status: EpisodeStatus;             // 処理ステータス

  audioFileName: string;             // Cloud Storage上のファイル名
  audioUrl?: string;                 // Cloud Storage 署名付きURL（or gsURL）

  transcript?: string;               // 文字起こし全文
  minutes?: string;                  // 議事録（Markdown）

  xPostRecommendations: string[];    // X投稿文の候補リスト
  conversationSeeds: string[];       // 会話のタネリスト

  spotifyUrl?: string;               // Spotify エピソードURL
  applePodcastUrl?: string;          // Apple Podcasts エピソードURL

  processingLog?: string[];          // パイプラインの処理ログ（デバッグ用）
};
```

### 設計コメント

**この構造で十分か**

現段階では1エピソード = 1ドキュメントのフラット構造で問題ない。`transcript` や `minutes` はテキストが長くなるが、Firestoreの1ドキュメント上限（1MB）に達するケースは通常のポッドキャストでは考えにくい。

**別コレクションへの切り出し検討ポイント**

| フィールド | 切り出し判断 |
|---|---|
| `xPostRecommendations` | 候補が増える・ユーザーが選択・履歴管理が必要になったら `episodes/{id}/xPosts` サブコレクションへ |
| `conversationSeeds` | 同上。`episodes/{id}/seeds` サブコレクション化を検討 |
| `processingLog` | ログが膨大になる場合は Cloud Logging または BigQuery に移す |
| `transcript` | 長文検索が必要になれば Algolia / Vertex AI Search との連携も視野に |

**スケール時の懸念点**

- **書き込み頻度：** パイプラインが各ステップで `status` を更新するため、処理中は1エピソードにつき複数回の書き込みが発生する。Firestoreの書き込み上限（1ドキュメント1秒）に注意。
- **リアルタイム更新：** UIで処理状況をリアルタイム表示する場合、`onSnapshot` を使うとコネクション数が増える。エピソード数が多い場合はポーリングも検討。
- **audioUrl の有効期限：** Cloud Storage の署名付きURLには有効期限がある。長期保存するなら `gs://` パスを保存し、UI側で都度署名付きURLを取得する設計を推奨。

---

## 7. 今後の開発ロードマップ

| Phase | 内容 | 状態 |
|---|---|---|
| Phase 1 | フロントエンドUI完成（モックデータ） | ✅ 完了 |
| Phase 2 | Firestore接続・実データ表示 | 🔜 次のステップ |
| Phase 3 | mp3アップロード実装（Cloud Storage連携） | ⬜ 未着手 |
| Phase 4 | 文字起こし・議事録生成パイプライン | ⬜ 未着手 |
| Phase 5 | X投稿文・会話のタネ自動生成 | ⬜ 未着手 |
| Phase 6 | RSS生成 | ⬜ 未着手 |
| Phase 7 | Spotify連携 | ⬜ 未着手 |
| Phase 8 | Apple Podcasts連携 | ⬜ 未着手 |

---

## 8. 開発方針

### データ取得層の分離

フロントエンドは **`src/lib/episodes.ts` のみを通じてデータを取得する**。ページやコンポーネントがモックデータや Firestore SDK を直接参照することはしない。

```
Page / Component
     ↓ 呼ぶだけ
src/lib/episodes.ts   ← ここだけ差し替えればFirestore移行完了
     ↓ 現在はモック
src/lib/mockEpisodes.ts
```

Firestore実装時は `src/lib/episodes.ts` の2関数を書き換えるだけで、画面側の変更は不要。

```typescript
// 現在（モック）
export async function getEpisodes(): Promise<Episode[]> {
  return mockEpisodes;
}

// Firestore実装後（イメージ）
export async function getEpisodes(): Promise<Episode[]> {
  const snapshot = await getDocs(collection(db, "episodes"));
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Episode));
}
```

### コンポーネント設計方針

- `src/types/episode.ts` の型定義を唯一の真実（Single Source of Truth）とする
- Firestoreのデータ構造を変更した場合、この型定義の更新から始める
- バックエンドチームとの型合わせはここを起点に議論する

---

## 9. ローカル開発環境の立ち上げ

```bash
# リポジトリをクローン
git clone https://github.com/sunaba-log/podcast-ui.git
cd podcast-ui

# 依存関係のインストール
npm install

# 開発サーバーを起動
npm run dev
```

ブラウザで `http://localhost:3000` を開く。

---

## 10. ディレクトリ構成

```
src/
  app/
    page.tsx                  # / エピソード一覧
    layout.tsx                # 共通レイアウト（ヘッダー）
    upload/
      page.tsx                # /upload アップロード画面
    episodes/
      [id]/
        page.tsx              # /episodes/[id] 詳細画面
  components/
    EpisodeCard.tsx           # 一覧カード
    StatusBadge.tsx           # ステータスバッジ
    CopyButton.tsx            # コピーボタン
    UploadForm.tsx            # アップロードフォーム
  lib/
    episodes.ts               # データ取得層（← Firestore移行時の差し替えポイント）
    mockEpisodes.ts           # モックデータ
  types/
    episode.ts                # Episode型定義
```
