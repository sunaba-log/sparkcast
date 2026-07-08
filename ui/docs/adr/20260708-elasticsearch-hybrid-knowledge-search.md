---
date: 2026-07-08
status: accepted
issue: https://github.com/sunaba-log/sparkcast/issues/101
---

# RAG 横断検索の Elasticsearch ハイブリッド検索対応

## Context

議事録チャットの横断検索は Firestore のベクトル検索（`findNearest` / COSINE /
768 次元）のみで実装されていた（`docs/adr/20260628-podcast-minutes-chat.md`）。
純粋なベクトル検索は日本語の固有名詞・製品名・略語などの厳密一致に弱く、
質問中のキーワードが議事録に存在してもチャンクを取りこぼすことがある。
キーワード一致（BM25）と意味検索（kNN）を併用するハイブリッド検索を導入したい。

## Decision

- **Elasticsearch をナレッジインデックスの追加バックエンド**とし、BM25
  （kuromoji アナライザ）と dense vector kNN の 2 検索を RRF（Reciprocal Rank
  Fusion）で融合するハイブリッド検索を実装する。
- **切り替えは環境変数**（`ELASTICSEARCH_URL` の有無）で行い、未設定なら従来の
  Firestore ベクトル検索のまま動作する。段階導入とロールバックを可能にするため、
  Firestore 実装は削除しない。切り替え層は `knowledge-index.ts` に閉じ、
  再インデックス・チャットはバックエンドを意識しない。
- **RRF はクライアントサイドで融合**する（`rrf.ts`、k=60）。Elasticsearch の
  RRF retriever はライセンス階層に依存するため、Basic ライセンスや
  セルフホストでも動く 2 クエリ＋アプリ側融合を選んだ。純粋関数として
  単体テストできる利点もある。
- **チャンクと meta（content_hash）を単一インデックスに同居**させ、`kind`
  フィールド（`chunk` / `meta`）で区別する。podcast 単位のインデックス分割は
  インデックス数の増殖を招くため行わず、`podcast_id` フィールドでフィルタする。
- **埋め込みは既存の Vertex AI**（`text-multilingual-embedding-002` / 768 次元）を
  両バックエンドで共用する。Elasticsearch 側の推論機能（ELSER 等）は日本語対応と
  依存の増加を考慮して採用しない。
- インデックスは初回書き込み時にマッピング付きで自動作成する（kuromoji を使う
  ため `analysis-kuromoji` プラグインが前提。Elastic Cloud は標準対応）。

## Consequences

- `ELASTICSEARCH_URL` を設定して再インデックスを実行するだけでハイブリッド検索へ
  移行できる。外せば Firestore に戻るが、**インデックスデータは相互移行されない**
  （それぞれのストアで再インデックスが必要）。
- 検索クエリはベクトルに加えて質問文テキストを使うため、検索インターフェースは
  `searchRelevantChunks(podcastId, { text, vector }, limit)` に変更した。
- Elasticsearch クラスタの運用（Elastic Cloud 等）が新たな外部依存になる。
  接続失敗時はチャットが全文コンテキストへフォールバックする既存挙動に乗る。
