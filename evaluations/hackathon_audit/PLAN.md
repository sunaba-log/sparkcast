# ハッカソン提出前の追加検証：計画・実行条件・現状整理

作成：2026-10-12。対象は SparkCast の AI 監査・音声編集・公開制御。結果は [RESULTS.md](RESULTS.md)、不具合は [ISSUES.md](ISSUES.md)、提出説明の可否は [CLAIMS.md](CLAIMS.md)。

## 1. 対象と実行条件

| 項目 | 値 |
| --- | --- |
| 対象コミット（固定） | `423ad746a8d1c2226ee3bb809e71dd67b8756100`（`origin/develop`。PR #230 のマージ、2026-10-11 22:06 JST） |
| 作業場所 | `develop` から作成した worktree・ローカルブランチ `verify/hackathon-audit`。既存ブランチ・未コミット変更は変更していない（開始時、既存の作業ツリーに未コミット変更なし） |
| devの配備済みコミット | **未確認**。実行環境に GCP の認証情報がなく、Cloud Run のリビジョンを参照できない。CD は develop→dev のため、配備済みコミットが対象コミットと一致するとは限らない。dev 上の結果は、別の検証対象として扱う |
| リポジトリの作業規則 | 専用の規則ファイル（CLAUDE.md 等）はない。`.github/pull_request_template.md`（概要・関連issue）と `apps/automator/app/docs/ENVIRONMENT_AND_TEST_SPEC.md`（`make lint`・`make test`・全件テスト）に従う |
| 実行環境の区別 | 本文書の各結果に、**[モック]**（依存の差し替え）・**[エミュレータ]**（ローカルPostgreSQL 16＋Firestoreエミュレータ）・**[実API]**（利用者PCからの実API呼び出し）・**[dev実環境]** を付ける |
| 禁止事項 | main へのマージ・本番配備・本番RSS/X/Discordへの送信・公開音声のアップロード・共有devの設定変更をしない。秘密情報・署名付きURLを記録しない |
| データ | 架空の氏名・連絡先・機密語（例：「案件コード：スイレン742」）のみ使用する |

## 2. 現在のコードから読み取った処理（一次情報）

### 2.1 状態遷移（`episodes.status`）

```
upload_pending → uploaded → processing ─(文字起こし・要約)─┐
                                                          ▼
                     ┌───────── 監査無効（JEV_ENABLED=false または番組設定 enabled=false）──────────┐
                     │                                                                         ▼
          auditing ──┤ 指摘なし（policy_findings も訂正介入も 0 件）─────────────────────→ 公開処理 → completed
                     │ 指摘あり ─→ awaiting_approval ─┬ 承認あり：apply-interventions → editing → 公開処理 → completed
                     │                               └ 全却下：awaiting_publish_confirmation → confirm-original-publish → processing → 原音声で公開
                     └ 監査失敗・結果欠落など → failed（公開しない）
retry-audit：どの状態からでも auditing に戻して監査からやり直す（状態の前提条件なし）
```

### 2.2 監査で外部に渡るもの（`fact_check_auditor.py`、`fact_verification_agent.py`、`director_script_generator.py`）

| 段階 | 処理場所 | 入力 | 呼び出し条件 |
| --- | --- | --- | --- |
| PII検出（Presidio＋GiNZA、電話・郵便番号・URL・住所の独自パターン） | ローカル | 各チャンクの本文 | 監査有効時、全チャンク |
| 機密語の照合 | ローカル | 各チャンクの本文と番組の機密語・許可語 | 同上。大文字小文字のみ同一視する部分一致（NFKC・空白の正規化なし） |
| Jev ファクトチェック（Noul・Score・Choice） | 外部（TypeSafe） | 話者名・発話本文 | **全チャンク**。ローカル検出の結果で除外しない |
| Jev ポリシー判定（機密情報・第三者リスク） | 外部（TypeSafe） | 話者名・発話本文 | **全チャンク**（ファクトチェックと別の呼び出し） |
| Gemini 裏取り（Google検索付き） | 外部（Vertex AI） | 対象発話と前後3チャンクの文脈 | Jev の複合判定（`should_intervene`）が真のチャンク |
| Gemini 訂正案の生成 | 外部（Vertex AI） | 対象発話・文脈・裏取り結果 | 裏取りが「正しい」以外、または裏取り失敗時 |
| 代替台詞の再検査 | ローカル＋Jev | 代替台詞または録音の文字起こし | 代替音声の作成時 |

過去の確認と同様、「ローカルで判断できなかった発言だけを Jev に送る」構成ではない。全発話が Jev に2回送られる。

### 2.3 分岐（ワークフロー Step 2.5）

| 状況 | 実装上の動作 |
| --- | --- |
| 監査無効 | 監査を行わず公開処理へ進む |
| 監査用の文字起こし（セグメント）がない | 停止（failed） |
| Jev の接続失敗・不正応答・必須回答の欠落 | 停止 |
| 一部チャンクの結果欠落 | 停止 |
| 指摘なし | 公開処理へ進む（自動公開） |
| ポリシー指摘あり | awaiting_approval で停止 |
| 要訂正（`should_intervene`）で、Gemini 裏取りが「正しい」 | その発話の訂正案を作らない（**人の確認に回らない**） |
| 要訂正で、裏取りが失敗（None） | 根拠なしで訂正案を生成し、awaiting_approval |
| 訂正案の生成に失敗・空 | 停止 |
| 訂正生成が無効（DIRECTOR_ENABLED=false）で要訂正あり | 停止 |

### 2.4 データの流れ

| 出力先 | 内容 | 時点 |
| --- | --- | --- |
| Discord（通知） | **議事録全文**、タイトル・紹介文 | 監査の**前** |
| SQL `episodes.title/description`、Firestore `episodes_contents`（minutes・要約） | 原音声から作った議事録・紹介文 | 監査の前（中間保存） |
| Firestore `transcripts` | 原音声のセグメント・単語時刻 | 監査の前。編集後も上書きしない |
| GCS 監査トレース（dev は有効・90日保持） | 全チャンクの Jev 入力（発話本文）と判定 | 監査時 |
| Firestore `policy_findings` | 指摘の根拠文字列・チャンク本文 | 監査時 |
| R2（公開） | 音声（`{prefix}/ep/{番号}/audio.mp3` または `renditions/{plan}.mp3`）、RSS | 公開処理 |
| Firestore `rendition_transcripts`、minutes・要約の再生成 | 編集後のセグメントから再作成 | 編集計画の適用時 |
| SNS案 | 公開処理時の紹介文から生成 | 公開処理 |
| RAG（チャット） | minutes・要約に加え、**`transcripts`（原文）** を読む | 再索引時 |

### 2.5 新旧の編集経路

| 経路 | 入口 | 状態 |
| --- | --- | --- |
| 新：統合編集（PolicyEditProposal → AudioEditPlan → 自前ジョブ） | `policy-review`、`policy-audio`、`apply-interventions`（planVersion あり） | 現行。infra に配線済み |
| 旧：指摘単位の判断と外部編集サービス | `review-policy-findings`、`apply-interventions`（planVersion なし）→ `AUDIO_EDITOR_URL` | `policy_reviews/current` が無いときだけ使える。infra に `AUDIO_EDITOR_URL` の定義はない |

## 3. 検証の範囲と方法

| 検証 | 方法 | 実行場所 |
| --- | --- | --- |
| 1 監査・承認と公開の境界 | ワークフローを依存差し替えで実行し、公開処理（R2・RSS・完了）の呼び出しを記録。UI API はエミュレータで状態とジョブ起動を記録 | [モック]・[エミュレータ] |
| 2 編集結果と後続データ | 合成音（区間ごとに固有の周波数）でカット・無音化・置換の機械的な正しさと、単語時刻の誤差による残留を測る。後続データ（議事録・要約・SNS・RAG・通知）の再混入をワークフローとエミュレータで追跡 | [モック]・[エミュレータ]。実音声は [実API] |
| 3 監査の有効性・誤検知 | 8ケースの期待結果を先に固定。ローカル検出は手元で実行。Jev・Gemini・STT・TTS は利用者PCでハーネスを実行 | ローカル・[実API] |
| 4 新規データの認可 | 2利用者・2番組で、他番組のID・アセットIDへの差し替え。応答に加え、ジョブ起動・データ変更がないことを確認 | [エミュレータ] |
| 5 時間・費用・記録 | ローカル処理時間。実APIの呼び出し回数・量は利用者PCの実行結果から | ローカル・[実API] |

既存テスト（automator 42ファイル、UI の apply-interventions・retry-audit・policy 系など）と重複するケースは追加せず、実行結果だけを記録する。

## 4. 実APIの費用の見込み（上限 1,000円）

| API | 想定量 | 見込み |
| --- | --- | --- |
| Speech-to-Text（Chirp, long） | 評価音声 合計2分程度 × 数回 | 数円〜十数円 |
| Text-to-Speech（評価音声の作成・代替音声） | 数千文字 | 数円以内 |
| Gemini（裏取り・訂正案・要約） | 数十回 | 数十円以内 |
| Jev（TypeSafe） | 8ケース×（2呼び出し）×最大3回 ≒ 50回程度 | **単価が不明**。料金体系の確認が必要 |

Jev の単価が分かるまで、Jev を含む実行は最小件数（各ケース1回）から始める。
