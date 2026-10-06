# 変更前の確認結果

対象 `cc2fabc4940618210479e5ee13f8d5a131cac64c`、実施日 2026-10-06。クラウド設定・本番状態を検証した結果ではない。

## 前回計画からの変更

- Speech-to-Textの時刻・話者付きセグメントから議事録を作る経路が追加された。失敗時はGemini音声議事録へ切り替わる。以前の「transcriptは議事録」という説明を全経路へ一律に適用しない。
- developに監査・訂正台詞・TTS編集が追加された。訂正提案がある場合に承認待ちとなる停止経路がある。
- 承認UI/APIはPR #182で開発中。現時点の評価結果に含めない。
- RAGのsystemInstruction内のナレッジ配置、未公開SNS案の参照、ユーザー単位の履歴、SNSの既定Xクライアントへの切替は引き続き確認対象。

## 既存テスト

依存はUIで `npm ci --ignore-scripts --no-audit --no-fund`、Pythonで `uv sync --frozen` を使用。ロックファイルは未変更。

| 実行場所 | コマンド | 結果 |
| --- | --- | --- |
| `apps/ui` | `npm test -- src/server/chat src/server/usage-limit.test.ts src/server/recording-access.test.ts` | 4ファイル、23件成功 |
| `apps/automator/app` | `uv run --frozen pytest -o addopts='' tests/test_auto_post_sns.py tests/test_process_podcast_workflow.py tests/test_director_pipeline.py tests/test_transcript_pipeline.py tests/test_director_voice_synthesizer.py -q` | 59件成功、pydub由来の警告5件 |

対象を限定した既存テストであり、全CI・認可境界・実モデルの合格を意味しない。

## 公開境界の追加観測

実コードへ合成データと偽の外部サービスを注入し、ソケット接続も禁止して実行した。失敗ケースも観測結果として出力するため、スクリプトの終了コード0はセキュリティ合格を意味しない。

```bash
cd apps/automator/app
uv run --frozen python ../../../evaluations/ai_security/baseline_probe.py
```

| ケース | 観測結果 | 要件との関係 |
| --- | --- | --- |
| 監査API例外 | 音声とRSSへの公開書込呼出し、completedへの遷移 | 監査未完了を停止させる案に対して未達 |
| 監査応答のanswersが空 | 音声とRSSへの公開書込呼出し | 不完全応答の検出が必要 |
| セグメントなし・議事録あり | 監査APIを呼ばず音声とRSSへの公開書込呼出し | 代替経路のレビュー条件が必要 |
| 訂正提案あり | awaiting_approval、公開書込0件 | この条件で既存の停止を確認 |
| 未承認SNS・チャンネル資格情報欠落・既定クライアントあり | 既定クライアントの送信呼出し1件 | 承認と配信先の制御が必要 |

SNSケースは複合条件の観測。修正時は承認と資格情報を別ケースでもテストする。公開停止ケースでも通知呼出しは3回あるため、「外部共有が一切ない」とは言えない。

証拠：[JSON](evidence/baseline-observations.json)、[観測コード](../../evaluations/ai_security/baseline_probe.py)。本物の音声・SNS投稿・モデルAPI・クラウドDBは使用していない。コード上の経路を再現したもので、実被害の確認ではない。

## 残る依存関係

実モデル評価にはモデル・認証・予算、接続検証には検証用DB/Firestoreと利用者が必要。認証情報は本文・コミットへ保存しない。録音素材は架空の内容を自作し、原音声から事実一覧を確定する。#182の統合やdevelop更新後は、変更箇所に関係する結果を更新する。
