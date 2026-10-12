# 実API評価の実行手順（利用者のPCで実行）

検証3（監査の有効性・誤検知）と検証5（時間・呼び出し量）のうち、Jev・Gemini・Speech-to-Text・Text-to-Speech を使う部分の手順。合成データ（`cases.json`）だけを使う。DB・Firestore・RSS・X・Discord・R2 には書き込まない。

## 実行前に決めること

| 項目 | 内容 |
| --- | --- |
| Jev の単価 | TypeSafe の料金体系が不明。呼び出しは text 段階で16回、audio 段階で約8回（チャンク数×2）。単価を確認してから実行する |
| 一時保存先 | STT は GCS の URI が必要。**非公開**のバケットを `--bucket` に指定する（公開設定のバケットは中止する）。一時オブジェクトは処理ごとに削除する |
| 費用の上限 | 既定の上限：Jev 60回、Gemini 30回、STT 300秒。超える前に停止する |

## 費用の見込み（公開価格は実行時に要確認）

| API | 量（1回の通し） | 見込み |
| --- | --- | --- |
| Gemini（裏取り：Google検索グラウンディング付き、訂正案、範囲提案） | 最大10回程度 | グラウンディングの単価次第。数十〜150円程度 |
| Speech-to-Text（Chirp long） | 約70秒（原音声18秒＋編集後3本） | 数円 |
| Text-to-Speech（Neural2） | 約150文字 | 1円未満 |
| Jev | 約24回 | **不明** |

不安定な結果だけを最大3回まで繰り返す。合計 1,000円を超える見込みになったら止める。

## 手順

```bash
cd sparkcast && git fetch origin && git switch <検証ブランチ>
(cd apps/automator/app && uv sync --frozen) && npm ci --ignore-scripts --prefix apps/ui
gcloud auth application-default login && gcloud auth application-default set-quota-project sunabalog-dev
export EVAL_ALLOW_REAL_API=1 GOOGLE_CLOUD_PROJECT=sunabalog-dev
read -s TYPESAFE_API_KEY && export TYPESAFE_API_KEY   # 画面やチャットに貼らない

cd apps/automator/app
# 0. 配線確認（外部呼び出しなし）
uv run --frozen python ../../../evaluations/hackathon_audit/run_real_eval.py text --dry-run
# 1. テキスト監査（8ケース）
uv run --frozen python ../../../evaluations/hackathon_audit/run_real_eval.py text
# 2. 音声化→STT→監査（C1・C5・C7）
uv run --frozen python ../../../evaluations/hackathon_audit/run_real_eval.py audio --bucket <非公開バケット>
cd ../../..
# 3. UI と同じ範囲提案（Gemini）
EVAL_RUN_DIR=$PWD/evaluations/hackathon_audit/real_runs/<2の出力> \
  ./apps/ui/node_modules/.bin/vitest run --config evaluations/hackathon_audit/vitest.real.config.mts
# 4. カット・無音化・置換と再文字起こし
cd apps/automator/app
uv run --frozen python ../../../evaluations/hackathon_audit/run_real_eval.py edit --bucket <非公開バケット> --run ../../../evaluations/hackathon_audit/real_runs/<2の出力>
```

出力は `evaluations/hackathon_audit/real_runs/<日時>-real/` に保存される。JSON（`text_results.json`、`audio_results.json`、`handoff.json`、`proposals.json`、`edit_results.json`）を commit・push する。音声（`*.wav`）は `.gitignore` 対象で、手元で試聴する。
