# ハッカソン提出前の追加検証（AI監査・音声編集・公開制御）

| 成果物 | ファイル |
| --- | --- |
| 1. 検証計画・実行条件・現状整理 | [PLAN.md](PLAN.md) |
| 2. 合成テキスト・期待結果 | [cases.json](cases.json)（実API用）、`test_local_detection.py`（ローカル検出の期待値）。評価音声は実API実行時に TTS で生成 |
| 3. 再現用スクリプト・回帰テスト | `run-ui.sh`（UI/API：PostgreSQL＋Firestore エミュレータ）、`run-local.sh`（automator）、`run_real_eval.py`・`suggest-real.eval.ts`（実API） |
| 4. ケース別結果一覧 | [RESULTS.md](RESULTS.md) |
| 5. 根拠となるログ・出力 | `evidence/` |
| 6. 不具合・残課題 | [ISSUES.md](ISSUES.md) |
| 7. 主張できること・条件付き・言えないこと | [CLAIMS.md](CLAIMS.md) |
| 実API評価の手順 | [REAL_API_RUNBOOK.md](REAL_API_RUNBOOK.md) |

製品コードは変更していない。
