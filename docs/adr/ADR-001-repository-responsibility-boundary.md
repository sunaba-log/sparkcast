# ADR-001: Repository Responsibility Boundary

| 項目 | 内容 |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-06-05 |
| **Deciders** | チーム全員で合意が必要 |

---

## Context

sunaba-log Organization 配下に以下のリポジトリが並走している。

- `podcast-ui`
- `podcast-automator`
- `podcast-promoter`
- `podcast-manager`

2026-06-05 時点のアーキテクチャ調査で、以下の問題が明らかになった。

1. **Firestore への `episodes` データ書き込みが空白**: podcast-automator は処理結果（文字起こし・要約・音声 URL）を Discord に通知するだけで永続化していない。podcast-ui は Firestore に繋がっていない。
2. **podcast-promoter の前提データが存在しない**: `auto_poster.py` は `posts` コレクションを読んで X に投稿する実装が完了しているが、`posts` コレクションに書き込む処理が存在しない。
3. **podcast-manager と podcast-ui の責務が重複する**: 両者ともエピソード管理 UI を想定している。PoC 段階での方針が未定義。
4. **X 投稿文（xPostRecommendations）の生成責任者が未定義**: podcast-ui の `Episode` 型にはフィールドが存在するが、どのリポジトリが生成するか決まっていない。

この ADR は、PoC〜ハッカソン完了時点を想定した責務境界の合意を目的とする。

---

## Decision

### podcast-automator（バックエンドパイプライン）

**担う責務:**
- GCS へのアップロードをトリガーとした音声処理パイプライン全体
- Gemini (Vertex AI) による文字起こし・要約生成
- MP3 変換と Cloudflare R2 へのアップロード
- Cloudflare R2 の `feed.xml` 更新（RSS 管理）
- **Firestore `episodes` コレクションへの書き込み**（パイプライン完了後に書く）
- Discord 通知・週次アジェンダ Job

**担わない責務:**
- UI ロジック
- X への最終投稿処理

**この分担にする理由:** 音声処理の結果（transcript, title, audioUrl）を生成するのは automator のみであるため、その永続化責任も automator が持つのが自然。他のサービスは automator の書いたデータを読むだけにすることで、データの一貫性が保たれる。

---

### podcast-ui（管理コンソール）

**担う責務:**
- Next.js フロントエンド全般（画面表示・ナビゲーション）
- Firestore `episodes` コレクションからの読み取りと表示
- `/upload` 画面: ブラウザから GCS への直接 PUT（`app/api/upload` 経由で署名付き URL を取得）

**担わない責務:**
- Firestore への書き込み（読み取り専用）
- 音声処理ロジック
- RSS 生成

**Next.js `app/api` の制約:**
- GCS 署名付き URL の発行のみ
- ビジネスロジックは持たない
- 認証を実装した場合は、ここでセッション検証を追加する

**この分担にする理由:** UI が Firestore に直接書くと、バリデーション・認証・データ整合性の責任が UI に集中する。将来 API を独立させる際のコストが高くなるため、UI は読み取り専用とする。

---

### podcast-promoter（X 自動投稿）

**担う責務:**
- Firestore `episodes` の `status: "completed"` を検知して `posts` ドキュメントを生成・書き込む（**現在未実装・要追加**）
- `posts` コレクションから pending を読んで X API に投稿する
- Cloud Scheduler / Pub/Sub の設定

**担わない責務:**
- 音声処理
- RSS 管理

**この分担にする理由:** X 投稿はエピソード公開後の二次処理であり、パイプラインとは独立したライフサイクルを持つ。automator と切り離すことで、X 投稿のスケジュール変更・パターン変更が automator に影響しない。

---

### podcast-manager（将来 CMS）

**PoC 期間中の扱い:** 実装しない。podcast-ui で代替する。

**将来:** 本格 CMS として実装する場合は別途 ADR を作成し、以下の移管を検討する:
- podcast-ui のエピソード管理機能
- podcast-automator の RSS 管理機能（rss_manager.py）

---

### Firestore 書き込み責任の一覧

| コレクション | 書き込み責任者 | 根拠 |
|---|---|---|
| `episodes` | podcast-automator のみ | 処理結果の生成者が責任を持つ |
| `posts` | podcast-promoter のみ | 投稿スケジュールは promoter の内部データ |

---

## Consequences

### ポジティブな影響

- Firestore `episodes` の書き込み責任が明確になり、UI とバックエンドの疎通が可能になる
- `posts` コレクションへの書き込み手が定義されることで、promoter が動作する前提が揃う
- UI を読み取り専用に絞ることで、将来の認証・API 独立化のコストが下がる
- 各リポジトリの変更が他に影響しにくくなる

### 制約・トレードオフ

- podcast-automator に Firestore 書き込み処理の実装が必要（既存コードの変更）
- podcast-promoter に `episodes → posts` の変換処理の実装が必要（新規コード）
- UI からデータを直接修正できないため、エピソードタイトル等の編集機能を実装する場合は別途 API が必要

---

## Open Questions

以下はこの ADR では決定せず、今後のチーム議論に委ねる。

| No. | 質問 | 影響範囲 |
|---|---|---|
| Q1 | **認証方式**: Firebase Auth / GCP IAP / Google OAuth のどれを採用するか | podcast-ui, 将来の全サービス |
| Q2 | **podcast-manager の実装時期**: PoC 後いつ着手するか。着手時に podcast-ui と統合するか分離するか | podcast-ui, podcast-manager |
| Q3 | **RSS 管理の移管**: podcast-automator の `rss_manager.py` を将来 podcast-manager に移管するか | podcast-automator, podcast-manager |
| Q4 | **`xPostRecommendations` / `conversationSeeds` の生成責任者**: automator の pipeline 末尾で生成するか、promoter が `episodes` 完了後に書き戻すか | podcast-automator, podcast-promoter, podcast-ui |
| Q5 | **GCS 署名付き URL の認証**: UI の `app/api/upload` で誰でも発行できるか、認証済みユーザーのみか | podcast-ui |
