# Podcast Automator — Data Model (Proposed)

**最終更新**: 2026-06-05
**対象フェーズ**: PoC〜ハッカソン完了時点
**ステータス**: 🟡 Proposed — チームレビュー・ADR-001 Accepted 後に確定

---

> **⚠️ このドキュメントは提案中のデータモデルです。**
>
> - `docs/adr/ADR-001-repository-responsibility-boundary.md` が `Accepted` になるまでチーム合意済みではない
> - 記載されたコレクション・フィールドは実装されていない（As-Is との差分は [セクション 4](#4-既存実装との差分) を参照）
> - 実装・レビューを通じて変更される可能性がある
> - 状態表記の凡例:  `Current` = 既存コードに存在 / `🟡 Proposed` = 提案中 / `🔴 Open` = 未決定 / `🟢 Optional` = 将来任意で追加

---

## このドキュメントの目的

Firestore のコレクション設計（案）と、誰が何を書き・誰が何を読むかの責任分担を整理する。  
実装の拠り所ではなく、**チーム議論の出発点として使う**。

## 更新ルール

- コレクション・フィールドの追加/削除/型変更があった場合に更新する
- 実装の詳細（インデックス設定・クエリパターン等）はここには書かない
- ADR-001 が Accepted になった時点でステータスを更新する

---

## 1. コレクション一覧（Proposed）

> Firestore 上にはまだ存在しない。いずれも提案段階。

| コレクション | 用途 | 書き込み責任者（案） | 読み取り（案） |
|---|---|---|---|
| `episodes` | エピソード処理結果の永続化 | **podcast-automator のみ** | podcast-ui, podcast-promoter |
| `posts` | X 投稿スケジュール | **podcast-promoter のみ** | podcast-promoter（自己参照） |

> **設計原則（案）**: UI から Firestore に直接書かない。バックエンド処理の結果のみを永続化する。

---

## 2. `episodes` コレクション（Proposed）

### 責務（案）

podcast-automator が音声処理パイプラインを完了したエピソードの情報を保持する。  
podcast-ui はここを読んで画面を描画する。podcast-promoter はここを監視して投稿文を生成する。

**現状**: このコレクションは Firestore 上に存在しない。podcast-automator はまだ Firestore に書き込んでいない。

### フィールド定義

| フィールド | 型 | 説明 | 状態 |
|---|---|---|---|
| `id` | string | ドキュメント ID（自動採番） | 🟡 Proposed |
| `title` | string | Gemini が生成したエピソードタイトル | 🟡 Proposed |
| `status` | string | `uploaded` / `processing` / `completed` / `failed` | 🟡 Proposed |
| `createdAt` | Timestamp | アップロード日時 | 🟡 Proposed |
| `audioFileName` | string | GCS 上の元ファイル名 | 🟡 Proposed |
| `audioUrl` | string | Cloudflare R2 の公開 URL | 🟡 Proposed |
| `minutes` | string | Gemini が生成した議事録（Markdown） | 🟡 Proposed |
| `minutesGenerated` | boolean | 議事録生成完了フラグ | 🟡 Proposed |
| `xPostsGenerated` | boolean | X 投稿文生成完了フラグ | 🟡 Proposed |
| `seedsGenerated` | boolean | 会話のタネ生成完了フラグ | 🟡 Proposed |
| `xPostRecommendations` | string[] | X 投稿候補文リスト | 🔴 Open |
| `conversationSeeds` | string[] | 会話のタネリスト | 🔴 Open |
| `description` | string | Gemini が生成した番組紹介文（RSS 用） | 🟡 Proposed |
| `transcript` | string | Gemini が生成した文字起こし全文 | 🟡 Proposed |
| `processingLog` | string[] | デバッグ用パイプラインログ | 🟢 Optional |
| `publishedAt` | Timestamp | 各プラットフォームへの公開日時 | 🟢 Optional |

### `🔴 Open` フィールドについて

**`xPostRecommendations` / `conversationSeeds`**:
- podcast-ui の `Episode` 型にはこれらが定義されているが、**誰が生成して Firestore に書くかが未決定**
- 候補 A: podcast-automator のパイプライン末尾で Gemini 生成して書き込む
- 候補 B: podcast-promoter が `episodes` 完了を検知した後に生成して書き戻す
- チームでの意思決定が必要（→ ADR-001 の Open Questions Q4 参照）

### podcast-ui `Episode` 型との対応

`src/types/episode.ts` の `Episode` 型と Firestore フィールドの対応。  
差分は `src/lib/episodes.ts` で変換する（Timestamp → ISO 文字列 等）。

```
Firestore (episodes) [Proposed]   ←→  podcast-ui (Episode型) [Current]
  createdAt: Timestamp                  createdAt: string (ISO)
  minutes: string                       minutes: string
  xPostRecommendations: string[]        xPostRecommendations: string[]
  conversationSeeds: string[]           conversationSeeds: string[]
```

> `Episode` 型は `src/types/episode.ts` に実装済みだが、対応する Firestore コレクションはまだ存在しない。

---

## 3. `posts` コレクション（Proposed）

### 責務（案）

podcast-promoter が X への投稿スケジュールを管理する。このコレクションは podcast-promoter の内部データであり、他のサービスが直接読み書きしない。

**現状**: `podcast-promoter/app/firestore_schema.md` にスキーマ定義が存在するが、Firestore 上には未作成。`posts` を書き込む処理も未実装（`auto_poster.py` は読み取り側のみ実装済み）。

### フィールド定義

> フィールド名・型は `podcast-promoter/app/firestore_schema.md` と `app/domain/post.py` から確認できる。

| フィールド | 型 | 説明 | 状態 |
|---|---|---|---|
| `minutes` | string | 元の議事録（`episodes.minutes` から引用） | Current |
| `pattern` | string | 投稿パターン `"A"` / `"B"` / `"C"` | Current |
| `status` | string | `pending` / `posted` / `failed` | Current |
| `scheduled_time` | string | ISO8601 形式の投稿予定日時 | Current |
| `content` | string | 生成済み投稿文 | Current |
| `platform_urls` | object | `{ apple, spotify, amazon }` | Current |
| `hashtags` | string[] | ハッシュタグリスト | Current |
| `attention` | string | アテンション用要約 | Current |
| `main_theme` | string | メインテーマ | Current |
| `insight` | string | 気づき | Current |
| `core_quote` | string | パワーワード | Current |

> `Current` = `podcast-promoter/app/firestore_schema.md` および `app/domain/post.py` に定義済み。ただし Firestore 上には未作成。

### 運用ルール（案）

- `status: "pending"` かつ `scheduled_time` が現在時刻を過ぎたものが投稿対象
- 1 回のトリガーで最古の pending のみ処理
- 投稿成功: `posted` に更新 / 失敗: `failed` に更新

### 書き込みの流れ（未実装・Proposed）

```
podcast-automator
  episodes/{id} に status:"completed" を書く  ← 未実装
        ↓
podcast-promoter（Firestore トリガー or Pub/Sub）
  episodes/{id} を読んで minutes 等を取得
  3パターン（A/B/C）の posts ドキュメントを生成・書き込む  ← 未実装
        ↓
Cloud Scheduler が定期的に auto_poster.py を起動
  posts から oldest pending を取得して X API に投稿  ← 実装済み・未デプロイ
```

---

## 4. 既存実装との差分

> **このドキュメントの内容は To-Be 案であり、実装済み仕様ではない。**

| 事項 | 既存実装（As-Is） | このドキュメントの提案（To-Be） |
|---|---|---|
| Firestore `episodes` コレクション | **存在しない** | automator が書き込む（Proposed） |
| podcast-automator の Firestore 書き込み | **なし**（処理結果は Discord に通知して終了） | あり（episodes へ書き込む） |
| podcast-ui のデータ取得 | **`mockEpisodes.ts` を参照**（Firestore 未接続） | Firestore `episodes` を読む |
| podcast-promoter の `posts` 書き込み | **なし**（`auto_poster.py` の読み取り側のみ実装） | PostWriter を追加して書き込む |
| `xPostRecommendations` の生成 | **なし** | 生成責任者が未決定（🔴 Open） |

---

## 5. Firestore を使わない領域

| データ | 保存先 | 理由 |
|---|---|---|
| MP3 音声ファイル | Cloudflare R2 | バイナリデータ、Firestore 非適 |
| RSS フィード (feed.xml) | Cloudflare R2 | XML 形式、Podcast プラットフォームから直接参照される |
| 文字起こし全文（長尺時） | 将来的に GCS or R2 への切り出しを検討 | 長尺では Firestore 1MB 制限に抵触する可能性 |
