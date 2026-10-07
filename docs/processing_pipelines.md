# SparkCast 処理パイプライン詳細仕様

本ドキュメントでは、SparkCast において稼働する6つの自律的・自律分散型処理パイプラインの詳細なフロー、シーケンス図、エラーハンドリング、および最適化ロジックについて解説します。

> [!NOTE]
> 関連ドキュメント：
> - [システムアーキテクチャ全体像](file:///Users/onotakayoshi/Documents/Projects/sunabalog/SparkCast/sparkcast/docs/system_architecture.md)
> - [データベース・ストレージスキーマ](file:///Users/onotakayoshi/Documents/Projects/sunabalog/SparkCast/sparkcast/docs/database_and_storage_schema.md)
> - [サービスコンセプト・アピールポイント・AIエージェント](file:///Users/onotakayoshi/Documents/Projects/sunabalog/SparkCast/sparkcast/docs/service_concept.md)

---

## 1. パイプライン一覧

SparkCast は、収録から配信、プロモーション、ナレッジ再利用までを完全自動化・支援するため、以下の6つのパイプラインが連携して動作します。

| # | パイプライン名 | 実行トリガー | 実行コンポーネント |
|:---|:---|:---|:---|
| **1** | **ブラウザ収録・音源ミキシング** | ホストによる収録終了操作 | Next.js UI → Cloud Run Job (`mixer`) |
| **2** | **音声処理・AI解析・配信** | GCS への音声ファイル確定 | Eventarc → Workflows → Cloud Run Job (`app`) |
| **3** | **AIディレクター介入・訂正** | 音声処理内 (Jev監査) / UI承認 | TypeSafe AI (Jev) → UI → Cloud Run Job (`editor`) |
| **4** | **週次アジェンダ自動生成** | Cloud Scheduler (毎週水曜 07:00 JST) | Cloud Run Job (`agenda`) |
| **5** | **SNS自動プロモーション投稿** | Cloud Scheduler (定期実行) | Cloud Run Job (`promoter`) |
| **6** | **多ソースRAG・ベクトル同期** | エピソード完了時 / 毎朝 04:00 JST | Next.js API (`/api/cron/reindex-minutes`) |

---

## 2. ① ブラウザ収録・音源ミキシングパイプライン

Discord や外部録音ツールを不要にし、ブラウザの通話から話者別録音・高精度ミキシングまでを一貫して行うエッジ＆サーバーレスパイプラインです。

### 2.1 処理シーケンス図

```mermaid
sequenceDiagram
    autonumber
    actor Host as ホスト (ブラウザ)
    actor Guest as ゲスト (ブラウザ)
    participant SFU as Cloudflare Realtime SFU
    participant Worker as Cloudflare Worker + DO
    participant R2 as Cloudflare R2 (recordings)
    participant UI as podcast-ui (Cloud Run)
    participant Mixer as Cloud Run Job (mixer)
    participant GCS as GCS Input Bucket

    Host->>UI: 収録ルーム作成 (POST /api/recording/sessions)
    UI-->>Host: 招待URL & room JWT
    Guest->>UI: 招待URLから入室・同意チェック
    UI-->>Guest: room JWT
    Host->>SFU: WebRTC 接続
    Guest->>SFU: WebRTC 接続
    SFU-->>Host: ゲスト音声を中継 (低遅延 Opus)
    SFU-->>Guest: ホスト音声を中継 (低遅延 Opus)

    Note over Host,Guest: 録音開始 (各自のマイク手元で MediaRecorder WebM/Opus)
    Host->>Worker: ホスト本人のローカル録音チャンク送信 (10秒ごと)
    Guest->>Worker: ゲスト本人のローカル録音チャンク送信 (10秒ごと)
    Host->>Worker: ホスト側受信のゲスト予備録音チャンク送信
    Worker->>R2: チャンクを保存 & DO 台帳にミリ秒時刻を記録

    Host->>UI: 収録終了・確定 (POST /finalize)
    UI->>Mixer: Cloud Run Jobs API を起動 (env 上書き)
    activate Mixer
    Mixer->>R2: 全参加者のローカル録音 & 予備録音を取得
    Mixer->>Mixer: 予備録音との相互相関でクロックドリフト・オフセットを補正
    Mixer->>Mixer: 話者別トラックをアライメントし、無劣化 FLAC にミックス
    Mixer->>R2: アライメント済み話者別 FLAC を保存 (ダウンロード用)
    Mixer->>GCS: ミックス済み FLAC を配置 (ifGenerationMatch=0)
    deactivate Mixer
    Note over GCS: 次の音声処理パイプライン (Eventarc) が自動起動
```

### 2.2 設計の勘所と最適化

1. **通話と録音の分離（エッジ・ブラウザ最適化）**
   - 通話は Cloudflare Realtime SFU（月 1TB 転送無料）を通し、録音は各端末のブラウザ上で非圧縮に近いレート（MediaRecorder WebM/Opus 128kbps）で手元保存。
   - 通話回線の揺らぎやパケットロスが、録音音声の品質に一切影響しません。
2. **ホスト予備録音と相互相関（Cross-Correlation）アライメント**
   - ホスト側のブラウザは、ゲストから受信した音声もバックアップとして録音します。
   - mixer ジョブは、ゲストの手元録音とホスト側の予備録音との間で 8kHz / 8秒窓による相互相関（cross-correlation）を計算し、端末ごとのクロックずれ（1時間で数十〜数百ms）を1次式（offset と drift）で補正（FFmpeg `atempo` フィルタ適用）。
   - 「ホストに聞こえていたタイミング」に揃えることで、違和感のない自然な掛け合いを再現します。

---

## 3. ② 音声処理・AI解析・配信パイプライン

GCS への音声配置を契機に、音声認識・要約・文字起こし・RSS/R2公開を自動実行するコアパイプラインです。

### 3.1 処理シーケンス図

```mermaid
sequenceDiagram
    autonumber
    participant GCS as GCS Input Bucket
    participant Eventarc as Eventarc Trigger
    participant WF as Cloud Workflows
    participant Run as Cloud Run Job (app)
    participant STT as Speech-to-Text v2
    participant Gemini as Gemini API (2.5 Flash)
    participant Jev as TypeSafe AI (Jev API)
    participant R2 as Cloudflare R2 (配信)
    participant DB as PostgreSQL
    participant FS as Firestore
    participant Discord as Discord Webhook

    GCS->>Eventarc: オブジェクト確定 (Finalize)
    Eventarc->>WF: ワークフロー起動
    WF->>Run: Cloud Run Job (app) 起動 (GCSパス引数)
    activate Run
    Run->>DB: ステータスを processing に更新
    Run->>Run: 音声を MP3 に変換、再生時間・ファイルサイズ測定

    alt ブラウザ収録 (話者別トラックあり)
        Run->>Run: 各トラックから声のある区間 (VAD) を抽出 (voiced_audio)
        Run->>STT: BatchRecognize (longモデル, ダイナミックバッチ) を並行実行
        STT-->>Run: 正確な単語・発話タイムスタンプ付きテキスト
    else ミックス音声アップロード
        Run->>STT: BatchRecognize (longモデル) 実行
        STT-->>Run: タイムスタンプ付き発話テキスト
        Run->>Gemini: 音声と番組レギュラー設定 (cast_members) から各発話の話者を推定
        Gemini-->>Run: 推定話者名付き発話テキスト
    end

    Run->>Gemini: 文字起こしテキストから話題ごとの要点録 (minutes) とタイトル・概要を生成
    Gemini-->>Run: 要点録 Markdown (目次の時刻は文字起こし実時刻)

    Note over Run,Jev: Step 2.5: Jev 高速監査 (後述の③へ分岐)
    Run->>Jev: 全発話チャンクを非同期バッチで並行ファクトチェック

    opt 誤認検出なし、または承認完了後
        Run->>R2: MP3 アップロード (カスタムドメイン)
        Run->>R2: RSS フィード (feed.xml) に新規エピソード追記・アップロード
        Run->>FS: エピソード拡張メタ (episodes_contents) 保存
        Run->>FS: 1発話=1ドキュメント形式で文字起こし (transcripts) 保存
        Run->>Gemini: 要約からSNS告知文案 (3件) を生成
        Gemini-->>Run: SNS投稿テキスト候補
        Run->>FS: SNS投稿案 (sns_promotions, status=pending) 保存
        Run->>DB: ステータスを completed に更新
        Run->>Run: チャット知識ベース即時再インデックス (/api/cron/reindex-minutes)
        Run->>Discord: 完了通知 & 文字起こし結果送信
    end
    deactivate Run
```

### 3.2 音声認識の最適化とフォールバック

1. **ダイナミックバッチによるコスト削減（約80%削減）**
   - Speech-to-Text v2 の `long` モデル（東京リージョン `asia-northeast1`）を採用。
   - ダイナミックバッチ（1分 $0.003）を使用することで、通常認識（1分 $0.016）に比べコストを約 80% 削減。
2. **有声区間抽出（VAD: Voiced Audio Detection）**
   - ブラウザ収録の話者別トラックに対し、本人の声がある区間のみを抽出（雑音 + 10dB、前後余白付き）して音声認識へ投入。
   - 無音部分の認識リクエストを省くことで、認識時間を 60〜70% 短縮し、費用をさらに削減。
3. **二重のフォールバック・安全策**
   - **音声認識障害時**: Speech-to-Text がエラーとなった場合は、Gemini 2.5 Flash の音声モーダル直接入力による文字起こし（`gemini_audio`）へ自動フォールバック。
   - **無音検出時**: 発話が 1 件も検出されなかった場合（ミュート収録等）、AI 要約に回さずエピソードを直ちに `failed` にして空回りを防止。

---

## 4. ③ AIディレクター介入・訂正パイプライン

配信音声中の事実誤認や言い間違いを AI が自律的に検出し、人間の承認を経て自然な音声カットインで訂正する先進的な品質管理パイプラインです。

### 4.1 処理シーケンス図

```mermaid
sequenceDiagram
    autonumber
    participant Run as Cloud Run Job (app)
    participant Jev as TypeSafe AI (Jev API)
    participant Gemini as Gemini API
    participant FS as Firestore
    participant DB as PostgreSQL
    participant Discord as Discord Webhook
    actor User as ポッドキャスター (UI)
    participant UI as podcast-ui (Cloud Run)
    participant Editor as 音声編集ジョブ / TTS

    Run->>Jev: 全発話チャンク配列を非同期並行監査 (audit_chunks_async)
    Note over Jev: Noul (事実的主張か)<br/>Score (深刻度 1..5)<br/>Choice (誤りカテゴリ)
    Jev-->>Run: 監査メトリクス配列 (Score >= 3 を抽出)

    alt 重大な事実誤認 (Score >= 3) が検出された場合
        loop 重大誤認チャンクごと
            Run->>Gemini: 前後文脈と誤認内容から訂正原稿 (suggested_script) を起草
            Gemini-->>Run: 「ここで補足です。...」等の自然な訂正原稿
        end
        Run->>FS: 提案を director_interventions サブコレクションに保存
        Run->>DB: エピソードステータスを awaiting_approval に更新
        Run->>Discord: 訂正提案の承認要請通知を送信
        Note over Run: app ジョブはここで正常待機終了

        User->>UI: UI の AIディレクター承認パネルで確認
        User->>UI: 原稿を修正して「承認」または「却下」をクリック
        UI->>FS: ステータスを approved / rejected に更新
        UI->>DB: エピソードステータスを editing に更新
        UI->>Editor: 音声編集ジョブを起動 (POST /api/episodes/{id}/apply-interventions)
        
        activate Editor
        Editor->>Editor: Google Cloud Text-to-Speech (Neural2) で音声合成
        Editor->>Editor: 元音声の該当箇所前後にカットイン音声を挿入・クロスフェード
        Editor->>DB: エピソードステータスを completed に更新
        deactivate Editor
    end
```

### 4.2 Jev 高速監査の判定基準

- **Noul (客観的事実判定)**: 発言に客観的・検証可能な事実的主張（技術仕様、数値、固有名詞等）が含まれるか。
- **Score (深刻度 1〜5)**:
  - `1`: 軽微な言い間違い / 文脈上スルー可能
  - `2`: 軽微な誤り / 誤解を招く恐れなし
  - `3`: **明確な事実誤認 / 要訂正（ディレクター介入対象）**
  - `4`: 重大な誤認 / 信頼性に関わる（ディレクター介入対象）
  - `5`: 致命的な誤認 / 損害・混乱を招く（ディレクター介入対象）
- **Choice (カテゴリ分類)**: `technology`, `proper_noun`, `numerical_data`, `historical_fact`, `other`。

---

## 5. ④ 週次アジェンダ自動生成パイプライン

ポッドキャスターの次回収録準備を支援するため、過去の対話ログと外部最新ニュースを結びつけてアジェンダを自動生成するパイプラインです。

```mermaid
sequenceDiagram
    autonumber
    participant Sch as Cloud Scheduler (毎週水曜 07:00 JST)
    participant Run as Cloud Run Job (agenda)
    participant Disc as Discord (文字起こしch)
    participant RSS as 外部テックニュース (RSS)
    participant Gemini as Gemini API (Web Grounding)
    participant FS as Firestore
    participant Webhook as Discord (アジェンダch)

    Sch->>Run: Cloud Run Job (agenda) 起動
    activate Run
    Run->>Disc: 直近の発言ログ (Meeting Transcript) を取得
    Disc-->>Run: テキストログ
    Run->>Run: 過去の発言から議論の頻出テーマ (recurring_themes) や残課題を抽出
    Run->>RSS: テックニュースフィードを複数収集
    Run->>Gemini: 頻出テーマに関連するニュースをスコアリング & マッチング
    Gemini-->>Run: 関連度の高いニュース (上位3件) と選定理由
    Run->>Gemini: テーマ・ニュース・過去の発言証跡から次回論点 (Suggested Points) を生成
    Gemini-->>Run: アジェンダ構成案
    Run->>FS: topic_proposals ドキュメントとして保存
    Run->>Webhook: Discord のアジェンダチャンネルへリッチフォーマットで投稿
    deactivate Run
```

---

## 6. ⑤ SNS自動投稿パイプライン

公開されたエピソードの認知拡大を図るため、適切なタイミングで X (旧Twitter) へ自律的に告知投稿を行うパイプラインです。

```mermaid
sequenceDiagram
    autonumber
    participant Sch as Cloud Scheduler (定期実行)
    participant Run as Cloud Run Job (promoter)
    participant FS as Firestore
    participant X as X (旧Twitter) API

    Sch->>Run: Cloud Run Job (promoter) 起動
    activate Run
    Run->>FS: collectionGroup(sns_promotions) から status="pending" かつ scheduled_time <= 現在時刻 を取得
    FS-->>Run: 投稿対象リスト
    opt 投稿対象が存在する場合
        Run->>Run: 予定時刻が最も古いものを 1 件選択
        Run->>Run: メッセージ本文、ハッシュタグ、配信URLを整形
        Run->>X: ポスト送信 (Tweepy OAuth 1.0a User Context)
        alt 投稿成功
            Run->>FS: status を "posted" に更新
        else APIエラー
            Run->>FS: status を "failed" に更新
        end
    end
    deactivate Run
```

---

## 7. ⑥ 多ソースナレッジチャット (RAG) ＆ ベクトル同期パイプライン

過去の全エピソード議事録、次回アジェンダ、SNS投稿を横断して、質問に正確に回答する知識検索パイプラインです。

### 7.1 ベクトル同期（即時 ＋ 日次バッチ）

- **エピソード完了時の即時同期**: `app` ジョブが完了した直後に、UI の `/api/cron/reindex-minutes?podcastId={id}` を呼び出し。配信直後のエピソードもチャットですぐに参照可能。
- **毎朝 04:00 JST の差分再インデックス**: Cloud Scheduler が定期実行。
  - 各ソース（`minutes`, `agenda`, `sns`）のコンテンツハッシュを `minutes_index_meta` と比較。
  - 変更があったソースのみを Vertex AI `text-multilingual-embedding-002`（768次元）で再ベクトル化。
  - 削除されたエピソードのインデックスを自動クリーンアップ（冪等性の担保）。

### 7.2 チャット検索と回答生成（リアルタイム）

```mermaid
sequenceDiagram
    autonumber
    actor User as ユーザー (UI)
    participant UI as Next.js API (/api/chat)
    participant FS as Firestore (minutes_index)
    participant Gemini as Gemini API (2.5 Flash)

    User->>UI: 質問入力 (チャットウィジェット)
    activate UI
    UI->>Gemini: 質問テキストを 768 次元ベクトルに埋め込み
    Gemini-->>UI: 質問ベクトル
    UI->>FS: 議事録インデックスを KNN ベクトル検索 (findNearest, 類似度上位)
    FS-->>UI: 類似議事録チャンク群 (確定URL付き)
    UI->>FS: 最新の次回議題 & SNS投稿を全量取得 (固定注入)
    FS-->>UI: 議題・SNSコンテキスト
    UI->>Gemini: 統合コンテキスト + 厳格な引用指示 + 質問 を送信
    loop ストリーミング回答
        Gemini-->>UI: 回答チャンク (SSE)
        UI-->>User: リアルタイム描画 (Markdown + クリッカブルURL)
    end
    deactivate UI
```

- **ハルシネーション（リンク切れ）の根本対策**: リンク先 URL はコンテキスト注入時にプログラム側で確定（`/?episode=42`, `/agenda?proposal=...` 等）させ、Gemini には「指定された URL を一字一句そのまま出力する」ことだけを指示。URL の勝手な推測生成を完全に防止しています。
