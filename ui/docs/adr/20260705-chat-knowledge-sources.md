---
date: 2026-07-05
status: accepted
issue: https://github.com/sunaba-log/sparkcast/issues/75
---

# チャット知識源の多ソース化とリンク生成の設計

## Context

RAG チャット（[20260628-podcast-minutes-chat.md](20260628-podcast-minutes-chat.md)）は
知識源が配信済みエピソードの議事録・書き起こしのみで、次回議題（`topic_proposals`）や
SNS 投稿（`sns_promotions`）には回答できなかった。また回答内のエピソードリンクは
「コンテキスト見出しの ID から `/episodes/ID` を LLM が組み立てる」方式で、
不正な URL が生成されることがあった。

## Decision

- **知識源を `KnowledgeDoc`（sourceType: minutes / agenda / sns）に一般化**する。
  議事録・次回議題・SNS 投稿を同じ形（`sourceKey` / `title` / `url` / `content`）で
  扱い、チャンク化・埋め込み・検索・全文フォールバックのパイプラインを共通化する。
- **リンク先 URL はインデックス作成時に確定し、チャンクと一緒に保存する**。
  LLM へのコンテキストは各ブロックに `URL: ...` 行を持ち、システムプロンプトで
  「その URL を一字一句そのまま使う」ことだけを指示する。LLM に URL を
  組み立てさせない（リンク切れの根本対策）。
  - 議事録 → `/episodes/{episodeId}`
  - 次回議題 → `/agenda?proposal={proposalId}`
  - SNS 投稿 → `/sns?episode={episodeId}&post={promotionId}`
  - `/agenda`・`/sns` は上記クエリパラメータでの初期選択（ディープリンク）に対応する。
- **Firestore コレクション名（`minutes_index` / `minutes_index_meta`）は変更しない**。
  ベクトルインデックス（`embedding` フィールド）の再作成を避けるため。多ソース化は
  ドキュメントのフィールド追加（`source_type` / `source_key` / `title` / `url`）で行い、
  削除・入れ替えは `source_key` の単一フィールド等値クエリで行う（複合インデックス不要）。
- **再インデックスは冪等 ＋ stale クリーンアップ**。`sourceKey` ごとのコンテンツハッシュで
  変更分のみ埋め込み直し、現存しなくなったソース（削除された議題・SNS 投稿、
  旧形式の episode_id キーのドキュメント）はインデックスから削除する。

## Consequences

- 初回の再インデックスで全ソースが埋め込み直しになる（meta キー体系が
  `{episodeId}` → `{sourceType}:{...}` に変わるため）。以降は差分のみ。
- 旧形式のチャンクは検索時も議事録として解釈されるため、再インデックス前でも
  チャットは縮退せず動作する。
- API ルートのパス（`/api/chat/reindex`, `/api/cron/reindex-minutes`）は据え置き。
  Cloud Scheduler（infra/ui_cloud_scheduler.tf）の変更は不要。
