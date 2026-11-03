# Podcast Data Schema Specification

## 変更サマリー

本仕様は、Cloud SQL（PostgreSQL）を基幹データ、Firestoreを生成コンテンツ/運用コンテンツの格納先として扱うハイブリッド構成を定義する。

設計方針は次の通り。

1. 正規化が必要な主体データ（ユーザー、番組、エピソード、権限）はCloud SQLに保存する
2. AI生成物や時系列で増加する断片データ（文字起こしチャンク、SNS投稿候補、議題提案）はFirestoreに保存する
3. エピソードIDを共通キーとして、Cloud SQLとFirestoreを疎結合で接続する

## 1. Cloud SQL（PostgreSQL）ER図

```mermaid
erDiagram
    users ||--o{ podcast_ownerships : "has"
    podcasts ||--o{ podcast_ownerships : "owned_by"
    podcasts ||--o{ episodes : "contains"

    users {
        VARCHAR(255) user_id PK "Firebase Auth等のUID"
        VARCHAR(255) email UK
        VARCHAR(100) display_name
        TIMESTAMP created_at
    }

    podcasts {
        SERIAL podcast_id PK
        VARCHAR(255) title
        TEXT description
        TEXT cover_image_url
        TEXT rss_feed_path "Cloud StorageのパスまたはURL"
        TIMESTAMP created_at
    }

    podcast_ownerships {
        INT podcast_id PK,FK "REFERENCES podcasts"
        VARCHAR(255) user_id PK,FK "REFERENCES users"
        VARCHAR(50) role "owner, editorなど"
    }

    episodes {
        SERIAL episode_id PK
        INT podcast_id FK "REFERENCES podcasts"
        VARCHAR(255) title
        TEXT description
        TEXT source_audio_path "GCS入力パス"
        TEXT audio_file_path "R2公開URL"
        VARCHAR(20) status
        INT duration_seconds "再生時間(秒)"
        TEXT processing_error
        TIMESTAMP published_at
        TIMESTAMP created_at
    }
```

## 2. Cloud SQL テーブル仕様

### users

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| user_id | VARCHAR(255) | PK, NOT NULL | Firebase Auth UID |
| email | VARCHAR(255) | UNIQUE, NOT NULL | ログインメール |
| display_name | VARCHAR(100) | NULL | 表示名 |
| created_at | TIMESTAMP | NOT NULL, DEFAULT now() | 作成日時 |

### podcasts

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| podcast_id | SERIAL | PK | 番組ID |
| title | VARCHAR(255) | NOT NULL | 番組タイトル |
| description | TEXT | NULL | 番組説明 |
| cover_image_url | TEXT | NULL | カバー画像URL |
| rss_feed_path | TEXT | NULL | RSSファイルの保存先 |
| created_at | TIMESTAMP | NOT NULL, DEFAULT now() | 作成日時 |

### podcast_ownerships

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| podcast_id | INT | PK, FK -> podcasts.podcast_id | 番組ID |
| user_id | VARCHAR(255) | PK, FK -> users.user_id | ユーザーID |
| role | VARCHAR(50) | NOT NULL | owner, editor など |

### episodes

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| episode_id | SERIAL | PK | エピソードID |
| podcast_id | INT | FK -> podcasts.podcast_id, NOT NULL | 所属番組 |
| title | VARCHAR(255) | NOT NULL | エピソードタイトル |
| description | TEXT | NULL | 説明文 |
| source_audio_path | TEXT | NULL | GCS入力オブジェクトパス |
| audio_file_path | TEXT | NULL | 処理後の公開音声URL |
| status | VARCHAR(20) | NOT NULL | upload_pending, uploaded, processing, auditing, awaiting_approval, editing, completed, failed |
| duration_seconds | INT | NULL | 再生時間（秒） |
| processing_error | TEXT | NULL | 失敗理由 |
| processing_started_at | TIMESTAMP | NULL | 処理開始日時 |
| processing_completed_at | TIMESTAMP | NULL | 処理終了日時 |
| published_at | TIMESTAMP | NULL | 公開日時 |
| created_at | TIMESTAMP | NOT NULL, DEFAULT now() | 作成日時 |

## 3. Firestore ドキュメント構造仕様

Cloud SQLの podcast_id / episode_id を識別子として使用し、以下を格納する。

### 3.1 エピソード拡張コンテンツ（親ドキュメント）

パス:

podcasts/{podcast_id}/episodes_contents/{episode_id}

```json
{
  "updated_at": "2026-06-06T10:12:00Z",
  "transcript_summary": "このエピソードでは、大規模データやテキストデータを扱う際のデータベースの選定基準について話しています。特にCloud SQLとFirestoreを...",
  "ai_generated_meta": {
    "title": "【AI提案】生成AI時代のデータベース選定ガイド",
    "description": "今回はGoogle CloudのRDBとNoSQLの使い分けについて、Podcastの運用を例に挙げながら深掘りします。",
    "prompt_version": "v1.2",
    "generated_at": "2026-06-06T09:05:00Z"
  },
  "show_notes_summary": {
    "overview": "Google Cloudの各データベースの特徴と、Podcast管理システムにおける具体的な組み合わせ方法について議論しました。",
    "topics": [
      { "time": "00:00", "title": "オープニング" },
      { "time": "03:15", "title": "なぜ文字起こしデータはFirestoreに最適なのか" },
      { "time": "15:40", "title": "エンディング" }
    ]
  },
  "minutes": "# 議事録\n\n## 【目次】\n0:00 オープニング\n3:15 ...",
  "transcript_meta": {
    "engine": "speech_v2_long",
    "speaker_source": "recording",
    "segment_count": 412,
    "generated_at": "2026-10-04T09:05:00Z"
  }
}
```

- `minutes`: AI が作った議事録（Markdown）。#166 以降は、時刻・話者つきの文字起こし（3.2）から作るので、目次の時刻は実際の時刻になる。UI の表示は `editorial.minutes`（人が編集したもの）→ `minutes` の順。
- `show_notes_summary.topics`: `minutes` の【目次】から取り出した時刻とトピック。
- `transcript_meta.engine`: `speech_v2_long`（音声認識）または `gemini_audio`（音声認識に失敗したときの従来方式。3.2 は議事録の分割になる）。
- `transcript_meta.speaker_source`: `recording`（ブラウザ収録の話者別トラックを話者ごとに認識）／`gemini`（ミックス音声の各発話の話者を Gemini が推定）／`none`。

### 3.2 文字起こし断片（サブコレクション）

パス:

podcasts/{podcast_id}/episodes_contents/{episode_id}/transcripts/{chunk_id}

```json
{
  "chunk_id": "seg_00012",
  "start_time": 12.5,
  "end_time": 15.0,
  "speaker": "ゲストA",
  "speaker_id": "8f0c...（ブラウザ収録の参加者 ID。それ以外は null）",
  "text": "ここでCloudSQLとFirestoreの使い分けについてですが…"
}
```

- #166 以降は 1 発話 = 1 ドキュメント（`chunk_id` = `seg_00001` からの連番＝時刻順）。時刻は音声の先頭からの秒（Speech-to-Text v2 の単語の時刻）。再処理のときは古いドキュメントを消してから書く。
- それ以前のエピソードは、議事録を 1,200 字ごとに分けたもの（`chunk_0001`〜、`speaker: "unknown"`、時刻 0）。

### 3.3 SNS宣伝用投稿文（サブコレクション）

パス:

podcasts/{podcast_id}/episodes_contents/{episode_id}/sns_promotions/{promotion_id}

```json
{
  "status": "pending",
  "scheduled_time": "2026-06-01T10:00:00+09:00",
  "episode": {
    "number": 41
  },
  "message": "今回のテーマ: AI product strategy\\n\\nWe discussed AI product strategy updates.",
  "platform_urls": {
    "apple": "https://podcasts.apple.com/example-1",
    "spotify": "https://open.spotify.com/show/example-1",
    "amazon": "https://music.amazon.com/podcasts/example-1"
  },
  "hashtags": [
    "#Podcast",
    "#AI"
  ]
}
```

### 3.4 AI ディレクターの介入提案（サブコレクション）

パス:

podcasts/{podcast_id}/episodes_contents/{episode_id}/director_interventions/{intervention_id}

```json
{
  "intervention_id": "c6fd8ef2-6ac2-4f61-b43f-7b91a0e6dc27",
  "start_ms": 12500,
  "end_ms": 18750,
  "original_text": "ここは言い直して、えっと、その……",
  "speaker": "ゲストA",
  "jev_audit": {
    "noul": 0.82,
    "score": 0.91,
    "choice": "replace"
  },
  "suggested_script": "ここは改めて説明します。",
  "approved_script": null,
  "status": "pending",
  "created_at": "2026-10-06T00:00:00Z"
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `intervention_id` | string (UUID) | ドキュメント ID と同一の介入提案 ID |
| `start_ms` | number | 介入対象の開始位置（音声先頭からのミリ秒） |
| `end_ms` | number | 介入対象の終了位置（音声先頭からのミリ秒） |
| `original_text` | string | 置換または削除を提案する元の発話 |
| `speaker` | string | 対象発話者 |
| `jev_audit.noul` | number | Jev 監査の NOUL 指標 |
| `jev_audit.score` | number | Jev 監査の総合スコア |
| `jev_audit.choice` | string | Jev が選択した処理種別 |
| `suggested_script` | string | AI が提案する差し替え原稿 |
| `approved_script` | string \| null | 承認済みの差し替え原稿。未承認時は `null` |
| `status` | string | `pending`、`approved`、`rejected`、`applied` のいずれか |
| `created_at` | string (ISO 8601) | 介入提案を生成した UTC 時刻 |

### 3.5 次回収録向けの議題提案（トップレベル）

パス:

podcasts/{podcast_id}/topic_proposals/{proposal_id}

```json
{
  "proposal_id": 123,
  "target_period_string": "2026年 第23週 (06/01 - 06/07)",
  "generated_at": "2026-06-06T17:00:00Z",
  "related_news": [
    {
      "title": "Google Cloud、Cloud SQLの次世代アーキテクチャを発表",
      "url": "https://example.com/news/cloud-sql-next",
      "summary": "パフォーマンスが大幅に向上し、NoSQLライクな柔軟なインデックス機能が追加...",
      "source_reason": "エピソード #5 で話した課題を解決する手段としてタイムリーなため。"
    }
  ],
  "suggested_topics": [
    {
      "title": "発表されたCloud SQLの最新機能を、僕らのPodcastアプリに導入するべきか？",
      "description": "先日発表されたCloud SQLのアップデート内容を解説しつつ...",
      "suggested_points": [
        "新機能の概要と、自分たちの現在のアーキテクチャの振り返り",
        "コスト面・パフォーマンス面での移行メリットの有無"
      ],
      "related_past_episodes": [5, 8]
    }
  ]
}
```

## 4. Constraints & Indexes

### PostgreSQL 制約

1. podcast_ownerships.role は owner または editor を許容値とする
2. episodes.duration_seconds は 0 以上
3. episodes.published_at は episodes.created_at 以降
4. episodes.status は定義済み状態のみを許可する

### PostgreSQL 推奨インデックス

1. CREATE INDEX idx_episodes_podcast_created_at ON episodes (podcast_id, created_at DESC);
2. CREATE INDEX idx_episodes_podcast_published_at ON episodes (podcast_id, published_at DESC);
3. CREATE INDEX idx_podcast_ownerships_user_role ON podcast_ownerships (user_id, role);

### Firestore 推奨インデックス

1. collectionGroup: sns_promotions に対して (status ASC, scheduled_time ASC)
2. collectionGroup: transcripts に対して (speaker ASC, start_time ASC)（必要時）
3. collectionGroup: director_interventions に対して (status ASC, start_ms ASC)（UI で未処理提案を時刻順に読む場合）
4. podcasts/{podcast_id}/topic_proposals に対して (generated_at DESC)

## 5. Cloud SQL と Firestore の責務分離

### Cloud SQL に保存するもの

- ユーザー
- 番組
- 権限（誰がどの番組を編集できるか）
- エピソードの主データ

### Firestore に保存するもの

- AI生成メタ情報
- 文字起こしチャンク
- AI ディレクターの介入提案と承認状態
- SNS投稿候補（予約投稿状態含む）
- 次回収録向け議題提案

## 6. Migration Plan

1. Cloud SQLで users, podcasts, podcast_ownerships, episodes を先行作成
2. 既存アプリのID運用を podcast_id, episode_id に寄せる
3. Firestore に episodes_contents と各サブコレクションを作成
4. 投稿予約バッチ（Cloud Run）を collectionGroup(sns_promotions) ベースで接続
5. 運用開始後、検索頻度に応じて追加インデックスを作成

## 7. Open Questions

1. podcast_ownerships.role に viewer を含めるか
2. sns_promotions.status の状態遷移を pending -> success/failed 以外に拡張するか
3. episode.number を Cloud SQL 側で持つか（現在はSNSドキュメント内の補助情報）
4. transcript_summary の多言語対応（言語コード保持）を行うか

## 8. 音声アップロード連携契約

`podcast-ui` はCloud SQLにエピソードを作成し、ブラウザからGCSへ直接PUTするための署名付きURLを発行する。

GCSオブジェクトパス:

```text
podcasts/{podcast_id}/episodes/{episode_id}/source/{filename}
```

`podcast-automator` はGCS finalizeイベントで受け取るオブジェクトパスから
`podcast_id`と`episode_id`を抽出し、Cloud SQLおよびFirestoreへの書き戻しに使用する。
API詳細と制約は `docs/contracts/episode-upload.md` を参照する。
