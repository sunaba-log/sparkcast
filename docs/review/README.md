# 統合レビュー案内（第4回セキュリティ検証＋ハッカソン監査検証）

> **最初に読むこと：PR を作ると、共有 dev DB にマイグレーションが適用される**
>
> - `develop` 向けの PR を作るだけで、`.github/workflows/pr-preview.yml` が動く。対象は、`apps/ui/**` を変更する PR。
> - このワークフローは、**マージ前に** 共有 dev DB（Supabase dev）へ `npm run db:migrate` を実行する。
> - 今回の修正候補には migration が2つある：
>   - `015_widen_episode_status.sql`：列を広げるだけ
>   - `016_add_episode_number.sql`：列とインデックスの追加、既存行の補完 UPDATE
> - PR を作る前に、dev DB へ先に適用してよいかをチームで決めてほしい。
> - レビューは、下のブランチ・コミット・比較画面のリンクから PR なしでできる。GitHub の compare 画面は、PR ではないので CI は動かない。
>
> この資料の作成者は、PR の作成・マージ・配備を行っていない。

## 1. 位置づけ

- 記事のための検証と、その修正候補である。**提出前の取り込みは必須ではない。**
- レビューして問題がなければ、採用してほしい。提出日に間に合わなくてもよい。
- 採用するかどうかは、修正候補ごとに判断できるようにしてある。一覧は [ADOPTION.md](ADOPTION.md)。
- **PR #183（security/ai-assurance）は、別の適用保留作業である。** 今回の取り込み候補には含めない。

## 2. 資料の入口（基準・環境・日付を混同しないこと）

| | 第4回（前回） | ハッカソン監査（今回） |
| --- | --- | --- |
| ブランチ | `claude/sparkcast-security-part4-z0xi02` | `claude/hackathon-audit-verification` |
| 確認した先端 | `e14d39a`（2026-10-07） | 製品コードの修正は `dbfceea` まで。資料はこの文書を含むコミット |
| 検証の基準コミット | main `5ddf6d6`（2026-10-06、PR #179）。当時の develop の先頭は `cc2fabc` | develop `423ad746`（2026-10-11 マージ。2026-10-12 時点でも develop の先頭） |
| 検証日 | 2026-10-06〜07 | 2026-10-12 |
| 検証環境 | モック、ローカル PostgreSQL 16、Firestore エミュレータ。実モデル評価（Gemini）は一部実施 | モック、ローカル PostgreSQL 16（migrations 適用）、Firestore エミュレータ、ローカルの Presidio・GiNZA。**実API・dev・ブラウザは未実施** |
| 修正候補 | F1 `12ba72b`、F2 `6bca236`、F3 `e7a4974`、F4 `f574a18` | I-01 `b053ab5`、I-02 `fcfce23`、I-03 `f8c4598`、I-04・I-05 `dbfceea` |
| 入口の資料 | [merge-review.md（`e14d39a` 時点）](https://github.com/sunaba-log/sparkcast/blob/e14d39a4d8ada225e38e3a48c080bbf23faa58d7/docs/ai_security/merge-review.md) | [ISSUES.md](../../evaluations/hackathon_audit/ISSUES.md)（I-01〜I-05 の詳細） |
| 詳細 | [verification.md](https://github.com/sunaba-log/sparkcast/blob/e14d39a4d8ada225e38e3a48c080bbf23faa58d7/docs/ai_security/verification.md)、[evaluations/ai_security/](https://github.com/sunaba-log/sparkcast/tree/e14d39a4d8ada225e38e3a48c080bbf23faa58d7/evaluations/ai_security) | [RESULTS.md](../../evaluations/hackathon_audit/RESULTS.md)、[PROPOSALS.md](../../evaluations/hackathon_audit/PROPOSALS.md)、[DEV_CHECK.md](../../evaluations/hackathon_audit/DEV_CHECK.md) |
| 差分 | [develop との比較](https://github.com/sunaba-log/sparkcast/compare/develop...claude/sparkcast-security-part4-z0xi02) | [develop との比較](https://github.com/sunaba-log/sparkcast/compare/develop...claude/hackathon-audit-verification) |

前回の資料は、履歴として `e14d39a` のまま残している（このレビューのために書き換えていない）。

- 前回の資料に書かれた状態が、今も続いているとは限らない。
- 今回、2026-10-12 の develop に対して読み取りで確かめた結果は、[ADOPTION.md](ADOPTION.md) の「現在の develop でも該当するか」列にある。
- 特に、develop は前回の基準から約100コミット進んでいる。2026-10-10 の `4b145d5` で、RSS は番組ごとに DB から作り直す方式へ変わった。この変更は F1 の前提に影響する。

## 3. 推奨する読む順序

| 順 | 対象 | 読むもの | 時間の目安 |
| --- | --- | --- | --- |
| 1 | 全体 | この文書と [ADOPTION.md](ADOPTION.md) の一覧表 | 10分 |
| 2 | I-01（DB の列幅） | [`b053ab5`](https://github.com/sunaba-log/sparkcast/commit/b053ab5) 1ファイル | 2分 |
| 3 | I-02（番号と公開キー） | [`fcfce23`](https://github.com/sunaba-log/sparkcast/commit/fcfce23)、ISSUES の I-02 | 15分 |
| 4 | I-03 → I-04・I-05（再監査と判断の条件） | [`f8c4598`](https://github.com/sunaba-log/sparkcast/commit/f8c4598)、[`dbfceea`](https://github.com/sunaba-log/sparkcast/commit/dbfceea)（`review-gate.ts` から読む） | 40分 |
| 5 | F4（利用枠） | [`f574a18`](https://github.com/sunaba-log/sparkcast/commit/f574a18) | 10分 |
| 6 | F2＋F3（SNS 投稿） | [`6bca236`](https://github.com/sunaba-log/sparkcast/commit/6bca236)、[`e7a4974`](https://github.com/sunaba-log/sparkcast/commit/e7a4974)、前回 merge-review の残件1〜3 | 20分 |
| 7 | F1（他番組の公開） | ADOPTION の F1 欄。採用ではなく方針を決める | 10分 |

## 4. 取り込む場合の手順と注意

1. **取り込み用ブランチを作る**：レビュー担当者が、最新の develop から作る。
   - この資料のブランチは、そのまま develop へマージしない。評価用ファイルや証拠も含まれるため。
   - 評価資料も残すなら、ブランチごとのマージでもよい（履歴の書き換えは不要）。
2. **コミットを取り込む**：採用する単位（[ADOPTION.md](ADOPTION.md) §3）ごとに、次の順で `git cherry-pick` する。
   - 今回分は `b053ab5` → `fcfce23` → `f8c4598` → `dbfceea` の順。
   - 2026-10-12 の develop に対し、`git merge-tree` で読み取り確認した結果：
     - 製品コードの競合は、F1 だけ（`entrypoints/main.py` などの行の追加位置が重なる）。
     - 今回のブランチは、現在の develop の先頭 `423ad746` から直接作られた直線の履歴である。そのため、今回分を順に取り込めば競合しない。
     - 評価用のテストファイルは、そのファイルを追加したコミットがないと「modify/delete」になる。
       - 今回分：評価用のファイルは `bb3ecd8`・`4e8d662` が追加している。`b28c8a3` は、修正前の証拠を移動したコミット。
       - F3・F4：前回の `63ed094` が追加している。単独で develop に適用できることは確認した。テストが develop で通るかは未確認。
       - 評価ファイルが不要なら、競合の解消で削除してよい。
3. **テストを回す**：automator は `uv run pytest`、UI は `npx vitest run`。
   - 状態遷移は、実際の PostgreSQL で確認するのが望ましい：`evaluations/hackathon_audit/run-ui.sh`。
4. **PR を作る前**に、上の注意（dev DB への先行適用）をチームで合意する。
   - migration 番号が develop の新しい migration と重なる場合は、番号を付け直す（015・016 が使われていないかを確認する）。
5. **配備**：通常の CD に従う（develop → dev、main → 本番）。
   - F2 は `infra/promoter.tf` を変える。配備時に、promoter ジョブの環境変数（`PODCAST_ID`）が増える。
   - 配備前後の dev の状態は、[DEV_CHECK.md](../../evaluations/hackathon_audit/DEV_CHECK.md) で読み取り確認できる。

## 5. この資料で確認していないこと

- 前回の F1〜F4 と、今回の I-01〜I-05 を同時に適用した状態でのテスト。コード上の重なりの確認だけ。
- dev・本番の実際の設定、DB の列定義、配備中のコミット。
- 実API（Jev・Gemini・STT・TTS）、ブラウザでの画面操作、人による音声・訂正案の確認。

## 6. 関連ファイル

| 目的 | ファイル |
| --- | --- |
| 採用判断の一覧 | [ADOPTION.md](ADOPTION.md) |
| メンバーへの依頼文 | [REQUEST.md](REQUEST.md) |
| 記事執筆用の引き継ぎ（レビューには不要） | [ARTICLE_HANDOFF.md](../../evaluations/hackathon_audit/ARTICLE_HANDOFF.md) |
