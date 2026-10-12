# 実API評価の実行手順（利用者のPCで実行）

検証3（監査の有効性・誤検知）と検証5（時間・呼び出し量）のうち、Jev・Gemini・Speech-to-Text・Text-to-Speech を使う部分の手順。合成データ（`cases.json`）だけを使う。DB・Firestore・RSS・X・Discord・R2 には書き込まない。

## 実行前に決めること

| 項目 | 内容 |
| --- | --- |
| 実行の時期 | I-01〜I-05 の修正後（このブランチの最新コミット）に実行する |
| Jev の単価 | Jev 1.13 は入力 100万トークンあたり $0.042、出力は無料（利用者が確認した値。https://docs.typesafe.ai/models ）。実行の直前に同じページで再確認する。応答の `model` が Jev 1.13 であることを、出力の `calls[].model` で確かめる |
| 一時保存先 | STT には GCS の URI が必要。検証専用の**非公開**バケットを `--bucket` に指定する（`DEV_CHECK.md` §4。共有バケット、特にアップロード用のバケットは使わない）。一時オブジェクトは処理ごとに削除する |
| 費用の上限 | 追加のAPI費用は合計 **1,000円**まで。ハーネスの既定の上限は Jev 60回、Gemini 30回、STT 300秒。上限を超える前に停止する |
| 設定 | dev・本番の共有設定は変えない。ハーネスは DB・Firestore・RSS・X・Discord・R2 に書き込まない |

## 費用の見込み（実行時に公開価格を再確認する。1ドル＝160円で概算）

Jev は入力トークンで課金されるため、呼び出し回数ではなく入力量で見積もる。

- dry-run（`text --dry-run`）で、送信側で数えた入力量を記録した。16回で 14,010 文字（1回あたり約 880 文字）。内訳は発話、指示文、判定基準。
- 日本語は1文字あたり 1.5 トークン以下と仮定する。サーバー側で付く指示（量は不明）を、1回あたり最大 5,000 トークンと仮定する。
- そのうえで、text 段階（16回）は最大約 10万トークンになる。

| API | 量（1回の通し：text＋audio＋範囲提案＋edit） | 見込み |
| --- | --- | --- |
| Jev | 約 24〜30回、入力 最大 約20万トークン | 約 $0.01（**約2円**） |
| Gemini（裏取り：Google検索グラウンディング付き、訂正案、範囲提案） | 最大 10回程度 | グラウンディングが有料枠の場合、1回 $0.035 として最大 約 $0.35（**約60円**）。トークン代は数円 |
| Speech-to-Text（Chirp long） | 約70秒（原音声18秒＋編集後3本） | 約 $0.02（**約3円**） |
| Text-to-Speech（Neural2） | 約150文字 | 1円未満 |
| GCS（検証用バケット） | 数MBを数分間 | 1円未満 |

- 1回の通しで、**約70円以下**。結果が不安定なケースだけを最大3回まで繰り返しても、約200円以下の見込み。
- 合計で 1,000円を超える見込みになったら止めて、報告する。
- 実行後は次の値から実費を計算し、`RESULTS.md` §5 に記録する。
  - Jev：`text_results.json`・`audio_results.json` の `calls[].input_chars`（送信側）と `calls[].usage`（応答に含まれる場合）
  - Gemini：`calls[].usage`（`prompt_token_count` など）

## 手順

zsh では、コマンド行の途中に `#` のコメントを書かない。下のブロックは1つずつ順に貼る。

準備（API キーは `read -s` で入力し、画面やチャットに貼らない）：

```bash
cd sparkcast && git fetch origin && git switch claude/hackathon-audit-verification && git pull
(cd apps/automator/app && uv sync --frozen) && npm ci --ignore-scripts --prefix apps/ui
gcloud auth application-default login && gcloud auth application-default set-quota-project sunabalog-dev
export EVAL_ALLOW_REAL_API=1 GOOGLE_CLOUD_PROJECT=sunabalog-dev
read -s TYPESAFE_API_KEY && export TYPESAFE_API_KEY
```

0. 配線確認（外部呼び出しなし。`jev_input_chars` が見積もりの入力量）：

```bash
cd apps/automator/app
uv run --frozen python ../../../evaluations/hackathon_audit/run_real_eval.py text --dry-run
```

1. テキスト監査（8ケース）：

```bash
uv run --frozen python ../../../evaluations/hackathon_audit/run_real_eval.py text
```

2. 音声化→STT→監査（C1・C5・C7）。`<検証用バケット>` は `DEV_CHECK.md` §4 のバケット名：

```bash
uv run --frozen python ../../../evaluations/hackathon_audit/run_real_eval.py audio --bucket <検証用バケット>
```

3. UI と同じ範囲提案（Gemini）。`<2の出力>` は手順2が表示したディレクトリ名：

```bash
cd ../../..
EVAL_RUN_DIR=$PWD/evaluations/hackathon_audit/real_runs/<2の出力> ./apps/ui/node_modules/.bin/vitest run --config evaluations/hackathon_audit/vitest.real.config.mts
```

4. カット・無音化・置換と再文字起こし：

```bash
cd apps/automator/app
uv run --frozen python ../../../evaluations/hackathon_audit/run_real_eval.py edit --bucket <検証用バケット> --run ../../../evaluations/hackathon_audit/real_runs/<2の出力>
```

各段階の後に、表示された `jev`・`gemini`・`stt_seconds` の回数を確認する。費用の見込み（上の表）を超えそうなら、次の段階に進まない。

出力は `evaluations/hackathon_audit/real_runs/<日時>-real/` に保存される。JSON（`text_results.json`、`audio_results.json`、`handoff.json`、`proposals.json`、`edit_results.json`）を commit・push する。音声（`*.wav`）は `.gitignore` 対象で、手元で試聴する。
