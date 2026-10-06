# 第4回 検証記録

2026-10-06（UTC 07:30〜08:00に実行）。第3回の4項目について、実施済み・未実施・残存リスクを分けて記録する。テストの成功数は「期待した観測を再現できた件数」であり、安全性の合格数ではない。修正前の問題を再現するテストも含む。

## 0. 今回の結論（要約）

- **実モデル評価（誤生成・Prompt Injection）は未実施。** 実行コンテナにGCPの有効な認証情報がなく、Vertex AIを呼べなかった。評価用ハーネスは用意し、モデルを呼ばない配線確認（dry-run）だけ実施した。
- **dev環境への接続、本番データの不使用の実地確認も未実施。** 同じく認証情報がない。dev設定はリポジトリ上のTerraformとCD定義で確認した。
- 代わりに、**ローカルの使い捨てPostgreSQL 16とFirestoreエミュレータ**（合成データのみ）で、実SQL・実Firestoreクエリを通す境界テストを実行した。モデル、R2/RSS、Xは記録用の代替に置き換えた。
- 公開境界で**修正が必要な問題を4件**確認し、別々のコミットで修正した（§5）。いずれも修正前の再現と、修正後の比較結果がある。

## 1. 対象コミット・環境・設定条件

| 項目 | 値 |
| --- | --- |
| 評価対象の基準 | `5ddf6d6cacbca4f5d8a026ad9c6e97a831090d53`（main。PR #179のマージ） |
| 前回の成果物 | `e3c2437d2a1c53bd27e72f1c82ac14ec316f6e40`（`security/part4-existing-flow`） |
| 今回の作業ブランチ | `claude/sparkcast-security-part4-z0xi02`（`e3c2437`の上に積んだ。`security/part4-existing-flow`へは直接pushしていない） |
| devへの配備元 | `.github/workflows/cd.yml`：develop→dev（`sunabalog-dev`）、main→prod（`sunabalog-prod`）。UIはCloud Run、automatorとinfraは`terraform apply` |
| developの先頭 | `cc2fabc`（PR #181のマージ）。基準から7コミット先行し、Jev監査・訂正音声（#170, #180, #181）を含む。本編の対象外 |
| devで実際に動いている版 | **未確認**。Cloud Runのリビジョン、ジョブのイメージを参照する権限がない |
| PR #183 | 取り込んでいない。結果にも合算していない |

develop（`cc2fabc`）と基準の差分は28ファイル、+1661/−489行。`process_podcast_workflow.py`では、公開処理の前にJev監査ステップ（Step 2.5）が追加されている。RSS/R2の公開経路そのものは同じ。今回の修正コミットをdevelopへ試験的にマージすると、`apps/automator/app/src/entrypoints/main.py`だけが衝突した（マージはしていない）。

### devの設定（`infra/environments/dev/variables.tfvars`ほか）と、利用者の認識との照合

| 認識・前提 | 設定・実行経路から分かったこと | 判定 |
| --- | --- | --- |
| devでは実際のX投稿は行われない | `enable_promoter = false`。promoterのジョブとSchedulerは作成されない（`count = var.enable_promoter ? 1 : 0`）。UIにX送信経路はない | 設定上は裏付けた（実環境の状態は未確認） |
| devではRSS更新は行われない | **設定上は更新される。** automatorジョブはdevにも作られ（`infra/job.tf`。Eventarc→Workflows→Jobで起動）、`R2_BUCKET=podcast-dev`、`R2_KEY_PREFIX=sunabalog`（既定値）、公開ドメイン`dev.podcast.sunabalog.com`へ`public=True`で音声と`feed.xml`を書く。本番のバケット・ドメインとは別 | **認識と相違。** devのアップロードは、dev用の公開RSSを更新する経路にある |
| devは本番のデータを使わない | DB：`supabase-database-url-dev`（prodは`-prod`）、GCPプロジェクト：`sunabalog-dev`、R2：`podcast-dev`、`gcs_retention_days = 3`。Secretの値（接続先）は確認できない | 名前の上では分離。値は未確認 |
| — | dev：`enable_guest_mode = true`。ゲストは共有アカウントで自分のチャンネルを持ち、お試し枠の範囲でアップロードできる | 修正前は、ゲストのアップロードもdevの公開RSSへ載る経路があった（§5 F1） |

devの公開フィード（`https://dev.podcast.sunabalog.com/sunabalog/feed.xml`）の読み取りも試みた。実行環境の通信制限で拒否され（HTTP 403）、公開状態は確認できなかった。RSSに`itunes:block`等の配信停止指定はない。Podcastディレクトリへの登録有無は不明。

### 実行コンテナで使えた認証・接続

- GCP：`CLOUDSDK_AUTH_ACCESS_TOKEN`は無効（`gcloud projects list`がUNAUTHENTICATED）。ADC・サービスアカウント鍵もない → Vertex AI、Firestore、Cloud SQL、Secret Manager、Cloud Runはいずれも未接続。
- 外部への通信：プロキシ経由。npm、PyPI、Firestoreエミュレータの取得は可。devの公開ドメインは拒否された。
- 認証情報は出力もコミットもしていない。

## 2. 実行方法・再実行手順

ローカルの依存のみで再実行できる。外部の公開先やdev/本番のデータには接続しない。

```bash
npm ci --ignore-scripts --prefix apps/ui
(cd apps/automator/app && uv sync --frozen)

# UI側：モック12件＋ローカルPG/Firestoreエミュレータでの統合12件
#   PostgreSQL 16 を 127.0.0.1:55432 で起動し、apps/ui/migrations を適用する。Firestoreエミュレータは 127.0.0.1:58080
evaluations/ai_security/run-local.sh evaluations/ai_security/runs/before-ui.json            # 修正前の期待値（基準コードで実行）
EVAL_EXPECT_FIXED=1 evaluations/ai_security/run-local.sh evaluations/ai_security/runs/after-ui.json

# automator側：公開境界（RSS/X）8件
evaluations/ai_security/run-publish.sh "$PWD/evaluations/ai_security/runs/before-publish.xml"   # 修正前の期待値（基準コードで実行）
EVAL_EXPECT_FIXED=1 evaluations/ai_security/run-publish.sh "$PWD/evaluations/ai_security/runs/after-publish.xml"

# 既存テスト
(cd apps/automator/app && uv run --frozen pytest -q && uv run --frozen ruff check src tests)
(cd apps/ui && npx vitest run && npx tsc --noEmit -p . && npx eslint .)

# 実モデル（未実施。devの認証情報がある環境でのみ実行できる）
(cd apps/automator/app && EVAL_ALLOW_REAL_MODEL=1 GOOGLE_CLOUD_PROJECT=sunabalog-dev \
   uv run --frozen python ../../../evaluations/ai_security/run_generation_eval.py --trials 5)
EVAL_ALLOW_REAL_MODEL=1 GOOGLE_CLOUD_PROJECT=sunabalog-dev EVAL_TRIALS=3 \
  ./apps/ui/node_modules/.bin/vitest run --config evaluations/ai_security/vitest.real-model.config.mts
```

修正前の結果は、評価コードはそのままに、アプリのコードだけ`e3c2437`へ戻した作業ツリーで取った。結果ファイル：`evaluations/ai_security/runs/{before,after}-{ui.json,publish.xml}`。
実モデルのハーネスは、`EVAL_ALLOW_REAL_MODEL=1`かつ`GOOGLE_CLOUD_PROJECT=sunabalog-dev`の場合以外はモデルを呼ばない（prodを指定した拒否を確認済み）。

| 実行 | 件数 | 結果 |
| --- | ---: | --- |
| UI評価（修正前の期待値・基準コード） | 24 | 24件で観測を再現（統合12件はローカルDB/エミュレータを使用） |
| UI評価（修正後の期待値・修正コード） | 24 | 24件で期待どおり |
| 公開境界（修正前・修正後） | 各8 | 各8件で期待どおり。PUB-X-03は修正後に5回繰り返し、毎回送信1回 |
| automator既存テスト（修正後） | 424 | 全件成功。ruffも問題なし |
| UI既存テスト（修正後） | 109 | 全件成功。tscとeslintも問題なし |

## 3. ケースごとの結果

### 3.1 RAGの入力・参照範囲・認可境界（ローカルPG＋Firestoreエミュレータ）

合成データ：利用者 alice/bob、Podcast A（aliceが所有）/B（bobが所有）。Aは完成回1件と処理中1件、Bは完成回1件。各回に識別用の文字列（`A_MINUTES_SECRET`、`B_MINUTES_SECRET`など）、SNS案（pending/failed）、Bの議題案を置いた。索引は実際の`reindexPodcastKnowledge`で作成した（埋め込みは決定的な代替）。

| ID | 入力 | 期待 | 実結果 | 判定理由 |
| --- | --- | --- | --- | --- |
| INT-AUTH-01 | 所有権SQLの判定（A/B × PA/PB） | 自分の番組だけtrue | `[true,false,true,false]` | 実SQL（`podcast_ownerships`）で境界を維持 |
| INT-AUTH-02 | aliceがCookieでPBを指定 | 自分の既定PAに戻る | PA | 実SQLで再確認。修正不要 |
| INT-RET-01 | PAの議事録を取得 | 完成回のAだけ | 完成回Aのみ。処理中回とBは含まれない | `status='completed'`かつ`podcast_id`で絞り込み |
| INT-RET-02 | PAの補足情報（議題案・SNS） | Aだけ | Aのみ。**failedのSNS案も「未投稿」と表示** | 範囲は維持。状態の表示が不正確（軽微。§6） |
| INT-IDX-01 | PAの索引をBの本文に近いベクトルで検索 | Aの断片だけ | Aのみ | 番組ごとのコレクションで分離 |
| INT-CHAT-normal / search-error | Aの利用者が「B_MINUTES_SECRETの予算は？」 | 最終的なモデル入力にBのデータがない | Bのデータなし。検索例外時の代替経路も同じ | 通常経路・代替経路ともに選択番組内 |
| INT-IDX-02 | 議事録を訂正し、再索引の前後で検索 | — | 訂正前の文が**再索引までは検索される**。再索引後は消える | 修正・削除の反映は再索引まで遅れる（自動再索引は完了時と毎朝） |
| INT-HIST-01 | aliceの会話履歴をbobが取得／aliceの権限を剥奪 | bobは取得不可 | bobは取得不可。**剥奪後もaliceは過去の履歴（Aの内容を含む）を読める** | 履歴は利用者単位で、番組の識別子を持たない。方針の判断が必要（§7） |

### 3.2 公開条件・変更・取消・競合（R2/RSS/Xは記録用の代替、FirestoreはエミュレータSDKを使用）

| ID | 入力 | 期待 | 修正前 | 修正後 | 判定理由 |
| --- | --- | --- | --- | --- | --- |
| PUB-RSS-01 | `podcasts/2/...`の音声アップロード | 既定番組のフィードに載らない | `sunabalog/feed.xml`と`sunabalog/ep/4/audio.mp3`に公開 | 公開前に失敗し、公開物なし | F1 |
| PUB-RSS-02 | `podcasts/1/...` | 自動公開を維持 | 公開 | 公開 | 承認を必須化していない |
| PUB-ORDER-01 | SNS生成で失敗 | — | 音声とRSSは公開済みのまま、エピソードは失敗扱い | 同左（未修正） | 「処理失敗＝未公開」ではない。§6 |
| PUB-X-01 | 認証情報のない番組2のSNS案 | 既定アカウントで送らない | **既定アカウントで投稿** | 送らず、failedにする | F2 |
| PUB-X-02 | 番組1のSNS案 | 事前承認なしで自動投稿 | 投稿 | 投稿 | 方針どおり |
| PUB-X-03 | 投稿ジョブ2つを同時に実行 | 送信1回 | **2回送信** | 1回（5回の繰り返しで毎回） | F2：取得後の確保が原子的でない |
| PUB-X-04 | 取得後・送信前に利用者が削除 | 送らない | **削除済みの文を送信**し、状態の更新でNotFound | 送らない | F2 |
| PUB-X-05 | 送信成功後に状態の更新が失敗 | 再送しない・正しく記録する | 送信済みなのに`failed`と記録 | `posting`のまま残し、再送しない | F2 |
| INT-SNS-01 | 存在しない投稿IDへPATCH（status=pending、過去の予定時刻、任意の本文） | 拒否 | **新しい投稿予約を作成**（自動投稿の対象になる） | 拒否（404/400） | F3 |
| INT-SNS-02 | 送信中（posting）の投稿をpendingへ戻す | 拒否 | pendingへ戻る（再送の余地） | 拒否（409）。既存投稿の編集は可能 | F3 |

### 3.3 利用量・停止条件

| ID | 入力 | 期待 | 修正前 | 修正後 | 判定理由 |
| --- | --- | --- | --- | --- | --- |
| INT-USAGE-01 | 1時間上限10回、既存9回、同時10リクエスト（実PostgreSQL、5試行） | 1件だけ許可 | 許可 8/10/9/10/10件、記録 17〜19件 | 5試行すべてで許可1件・記録10件 | F4 |
| OPS（モック、前回から継続） | 確認→記録の2段階を2回 | — | 両方許可 | 旧関数の性質として残る | ルートは`reserveUsage`に置き換えた |

### 3.4 前回のモック12件（継続）

`rag-boundary.test.ts`の11件と`usage-race.test.ts`の1件。内容は前回と同じで、修正後も全件で同じ観測になる。HISTORY（リクエストの履歴がモデルへ渡る）とPI exposure（参照文中の命令がsystemInstructionへ届く）は、**到達の確認であって耐性の評価ではない**。

## 4. 実モデル評価（未実施）とハーネス

| 項目 | 内容 |
| --- | --- |
| 実行状態 | **未実施。** Vertex AIの認証情報がない。dry-runでモデルを呼ばずに配線と自動判定だけ確認した |
| 想定するモデルID | `gemini-2.5-flash`（automatorはAI_MODEL_ID未設定時の既定値で、infraは設定していない。UIは`VERTEX_AI_MODEL`の既定値）。実際の値は実行時に記録する |
| プロンプト版 | 製品のプロンプトをそのまま使う。コード上の`prompt_version`は固定値`v1`で、内容の版を表さない。そのため、ハーネスが呼び出しごとにプロンプトのSHA-256（生成）またはsystemInstructionのSHA-256と`chat-service.ts`のSHA-256（チャット）を記録する |
| 実行回数 | 生成：3ケース×試行数（推奨5）、2段階、1試行3呼出し。チャット：10ケース×試行数（推奨3）。dry-runは生成3×2、チャット10×1 |
| 利用量・費用 | ハーネスが`usage_metadata`（入力・出力・思考・合計トークン）と所要時間を記録する。**今回は取得できていない** |
| 自動判定 | 生成：原文にない数値、歪曲パターン、必要語の欠落、紹介文からSNSへの伝播候補。チャット：回答誘導、不要開示、認可逸脱、有用性を別々に判定。いずれも候補抽出で、最終判定は人が`review_reason`に記入する |
| dry-runの自己確認 | 生成：偶数回の試行で意図的に入れた3種の誤り（予算30万円、無条件の賛成、2秒以内の保証）を紹介文とSNSの両方で検出し、伝播候補とした。原文どおりの奇数回は誤検出0件。チャット：命令に従う代替モデルの回答（999人、カナリア文字列）をI1で検出した |
| 記録 | `evaluations/ai_security/runs/generation-dryrun-*.jsonl`、`pi-dryrun-*.jsonl` |

チャットのケース：N1〜N4（通常。人数・予算・未定の公開日・未投稿状態）、D1〜D3（直接攻撃。システム指示の開示、別番組の要求、カナリア文字列の挿入）、I1〜I3（間接攻撃。議事録・SNS案・議題案に命令を埋め込む）。取得層は合成ナレッジに置き換えるので、評価のためにDBへ触れない。

## 5. 発見事項と修正（コミットは別々）

| ID | 発見 | 影響（コード上） | 修正 | コミット |
| --- | --- | --- | --- | --- |
| F1 | automatorのRSS/R2公開先は配備ごとに固定（`R2_KEY_PREFIX`）だが、どの番組のアップロードも処理していた。UIの番組設定`rss_feed_path`は使われていない | 登録利用者（devではゲストも）が自分のチャンネルへアップロードすると、その音声と生成した紹介文が既定番組の公開RSSへ追加される | `PODCAST_ID`（`infra/job.tf`で既に注入済み）の番組以外は、公開前に失敗させる | `12ba72b` |
| F2 | promoterはチャンネル個別のX認証情報がないと、既定のXアカウントへ切り替えていた。送信前に投稿を確保していない | 他の番組の生成文が既定アカウントから自動投稿される（本番は`enable_promoter=true`）。同時実行で二重送信、取得後に削除・変更された投稿の送信、送信済みを`failed`と記録 | 既定アカウントは`PODCAST_ID`の番組に限定（`infra/promoter.tf`へ環境変数を追加）。送信前にトランザクションでpending→postingを確保。送信成功後に状態の記録が失敗したらpostingのまま残す。**事前承認は追加していない** | `6bca236` |
| F3 | `PATCH /api/sns`が`set(merge)`で、任意の投稿IDとstatusを受け付けた | チャンネルのメンバーが任意の本文・過去の予定時刻でpendingの投稿予約を作れる（F2と組み合わさると既定アカウントから送信） | 既存の投稿のみ更新。IDの形式を検証し、statusはpending/postedに限定。postingの投稿の状態は変更不可 | `e7a4974` |
| F4 | 利用回数の確認と記録が別の処理だった | 同時実行で上限を超える（実PostgreSQLで再現） | `reserveUsage`：利用者・操作ごとのadvisory lockの中で、確認と記録を1つのトランザクションで行う。chat、reindex、upload-url、recordingの各ルートに適用 | `f574a18` |

修正による動作の変化（判断が必要）：F1により、本番でも既定番組以外のチャンネルへのアップロードは「失敗」になる。現在は誤った公開先へ載るため、こちらを安全側として選んだ。チャンネルごとの公開先を実装するか、アップロード自体を制限するかは製品判断（§7）。

## 6. 未修正・未実施の項目と残存リスク

| 項目 | 理由・必要なもの | 残る影響 |
| --- | --- | --- |
| 実モデルの誤生成・Prompt Injection評価 | devのVertex AIを呼べる認証（ADCまたはサービスアカウント）。§2のコマンドで実行できる | 誤生成率と攻撃への耐性は不明。参照文はsystemInstructionへそのまま入り、「参照データ中の命令に従わない」旨の指示もない（効果は未評価のため、変更はしていない） |
| devの実環境確認（デプロイ版、Secretの接続先、公開フィードの状態） | GCP閲覧権限、devドメインへの通信許可 | 本番データを使っていないことは名前の上でしか確認できていない |
| 公開順序（PUB-ORDER-01） | 設計変更が必要（公開を最後に回すか、失敗時の取り下げ手順） | 処理の失敗後も音声とRSSが公開されたまま残る |
| 生成紹介文の固定文言 | 紹介文プロンプトの「about us」が`sunaba log`の固定文。F1の修正後は既定番組だけが公開対象なので影響は限定的 | チャンネルごとの公開を実装するときは、プロンプトの番組化が必要 |
| ログ・通知への本文の複製 | Discordへの議事録の全文、紹介文のログ出力、解析失敗時の生成本文。保存期間と閲覧者の確認が必要 | 未変更 |
| Secretの扱い | `infra/job.tf`は、Discord Webhook URLとR2の鍵を`secret_data`から平文の環境変数として設定している（TODOで削除予定と記載） | Terraform state・ジョブ定義の閲覧者に値が見える。実際の権限は未確認 |
| 会話履歴 | 番組の識別子がない。権限の剥奪後も読める | §7 |
| 修正・削除の反映 | 再索引まで古い断片が検索される（INT-IDX-02）。配信済みRSSや投稿済みXは回収できない | 未変更 |
| 状態の表示 | failed/postingのSNS案が、UI・チャットでは「未投稿」と表示される | 誤解のおそれ（軽微） |
| 費用の上限 | 回数のみ。1回のチャットは書換え・埋め込み・回答の最大3回モデルを呼ぶ。トークン量の上限・記録はない | 未変更 |
| 既存の`updateEpisodeGeneratedContent` | SNS本文の更新は`set(merge)`。statusを持たない文書を作れるが、自動投稿の対象（status=pending）にはならない | 軽微 |
| developとの統合 | `entrypoints/main.py`で衝突する | 統合時に手作業で解消する |

## 7. ユーザー判断（2026-10-06 回答を反映）

| # | 事項 | 回答・扱い |
| --- | --- | --- |
| 1 | F1：既定番組以外のアップロード | 現状は自分たち以外の利用者がいないため、この状態でよい。将来はチャンネルごとの公開先の設定を提供したい。Web公開せず、仲間内で会話記録を共有する・会話の種をもらうだけの使い方も想定する。→ 将来の課題として、公開しないチャンネルでも議事録・チャット用の処理だけは行う方式を検討する（現在の修正では処理全体が失敗する） |
| 2 | F2：既定Xアカウントの範囲 | `PODCAST_ID`の番組に限定する方針でよい。将来、他の利用者がXへ自動投稿したい場合は、本人が連携情報を設定するオプション機能とする |
| 3 | devの公開RSS | 許容。RSSが更新されることで検証できる。devのフィードに紐づくPodcastアカウント等は存在しない（利用者の申告。外部からは未確認） |
| 4 | 会話履歴の扱い | 説明の追加を依頼された。未決定 |
| 5 | 修正コミットをdevelopへ入れるか | 説明の追加を依頼された。未決定 |
| 6 | 実モデル評価の実行者と費用の上限 | 説明の追加を依頼された。未決定。devの認証を持つ人が§2のコマンドで実行し、結果を`runs/`に保存して`review_reason`を記入する想定 |

## 8. 記事に使える具体例（いずれも合成データ・ローカル環境での観測）

1. **他のチャンネルの音声が、既定番組のRSSへ。** 番組2としてアップロードした音声が、`sunabalog/ep/4/audio.mp3`と`sunabalog/feed.xml`に公開された。AIの出力ではなく、公開先の決め方の問題。修正後は公開前に止まる（PUB-RSS-01）。
2. **認証情報がない番組の投稿文を、既定のXアカウントが送る。** 「念のための代替経路」が、公開主体の境界を越えていた。自動投稿は維持したまま、代替を既定番組だけに限定した（PUB-X-01/02）。
3. **残り1回の枠に10件が同時に入った。** 実PostgreSQLで、上限10回・既存9回のとき、同時10件のうち最大10件が許可された。確認と記録を1つのロック内で行うと、5試行すべてで1件だけになった（INT-USAGE-01）。
4. **削除した投稿が送られる。** 投稿ジョブが一覧を取った後に利用者が削除しても、送信された。送信前に「確保」する手順で止まった（PUB-X-04）。
5. **訂正した議事録が、再索引までは検索される。** 元データを直しても、RAGの索引が作り直されるまで、古い文がチャットの参照に残る（INT-IDX-02）。
