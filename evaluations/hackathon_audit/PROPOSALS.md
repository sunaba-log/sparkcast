# 修正の提案（未実装・レビュー待ち）

I-06 と I-09 の修正案。どちらも未実装で、レビュー後に実装する。

## 1. I-06 訂正台詞の再確認（既存の版管理に合わせる）

### 現状（`dbfceea` 時点）

- 代替音声の台詞（ポリシー指摘の置換）：合成・録音の時点で `verify_text` が検査する。
  - 検査の内容：ローカルPII、機密語、Jev のポリシー判定。
  - 1件でも検出すると、合成そのものを拒否する（`policy_media_main.py`）。
- 訂正介入の台詞（Gemini が生成し、利用者が編集できる）：検査しない。
  - 承認すると、台詞の文字列がそのまま編集計画（`audio_edit_plans/{id}.corrections`）に固定される。
  - 自動処理ジョブが編集時に合成し、挿入する（V2-05、V2-UI-01）。
- 版管理：
  - `policy_reviews/current` が `version`・`transcriptRevision`・`sourceGeneration` を持つ。
  - 判断を保存するたびに `version` が上がる。編集計画は、その版で固定される。

### 方針

- 検出したら一律に禁止するのではなく、**検査結果を表示し、人が確認したうえで承認する**ようにする。
  - 訂正の台詞では、固有名や数字が正当に必要な場合がある（許可語、公開済みの事実など）。
- 台詞を変更したら、以前の検査結果と承認を無効にする。再検査と再承認を求める。

### 変更案

1. **検査の記録**（自動処理側に検査だけの操作を追加。`verify_text` は拒否せず、結果を返す形にする）。
   - 訂正介入ごとに `script_check` を保存する：
     - `scriptHash`：台詞の SHA-256
     - `policyVersion`
     - `checkedAt`
     - `status`：`clear`（指摘なし）／`flagged`（指摘あり）／`error`（検査できない）
     - `findings`：ローカルPII・機密語・Jev のそれぞれについて、種類と該当箇所
   - 検査するのは次のとき：
     - 訂正案を生成したとき
     - 利用者が台詞を編集して保存したとき
     - 番組のポリシー（`policyVersion`）が変わったとき
2. **表示**：訂正介入パネルに、検査結果を表示する。
   - 該当箇所を強調する。
   - `error` のときは「検査できませんでした」と表示し、再検査ボタンを出す。
3. **承認の条件**（`review-gate.ts` に追加）：
   - `script_check.scriptHash` が、現在の台詞のハッシュと一致すること（検査後に台詞が変わっていない）。
   - `status` が `clear`、または `flagged` で、利用者が該当箇所を確認した記録があること：
     - `acknowledgedFindingsHash`
     - 確認者
     - 理由の短文
   - `error` は承認できない（再検査が必要）。
     - 代わりに、`flagged` と同じ確認で承認できるようにする案もある。どちらにするかは要判断。
4. **変更時の再承認**：承認後に台詞を編集したら、次のようにする。
   - 状態を `pending` に戻す。
   - `policy_reviews/current.version` を上げる。
   - 古い版で固定した編集計画は、既存の版の確認で使えなくなる（既存の仕組みのまま）。
5. **編集計画への固定**：`createPolicyEditPlan` で、次のものを計画に固定する。
   - `corrections[]` の台詞
   - `scriptHash`
   - `script_check` の要約
   - 確認の記録
6. **合成音声の固定**（任意。2段階目）：
   - 承認時に台詞を合成し、代替音声と同じアセット（`sha256` 付き）として保存する。
   - 編集計画はアセットIDとハッシュを参照する。
   - 自動処理ジョブは編集時にハッシュを確かめる。合成し直さない。
   - これで、人が試聴した音声と公開音声が一致する。

### 確認方法（実装後）

- 機密語を含む台詞を保存すると、`flagged` になり、該当箇所が表示されること。
  - 確認なしでは承認できない（409）。確認すれば承認できる。
- 承認後に台詞を編集すると `pending` に戻り、古い版での編集開始が 409 になること。
- 指摘のない台詞は、従来どおり承認・編集できること。

既存の V2-UI-01 は、修正後の期待（確認なしでは計画に入らない）に書き換える。テストを重複して増やさない。

### 決めてほしいこと

- `error`（検査できない）を承認不可にするか、確認つきで承認可にするか。
- 合成音声の固定（6）を、今回の範囲に含めるか。

## 2. I-09 Discord 通知

### 送信先

- 通知先は、自動処理ジョブ（`apps/automator`）の Discord webhook 1つ。
  - `SECRET_NAME` が設定されていれば、Secret Manager の JSON の `discord_webhook_url` を使う。
  - 設定されていなければ、環境変数 `DISCORD_WEBHOOK_INFO_URL` を使う。
- infra（`job.tf`）は `SECRET_NAME` を設定していない。代わりに `DISCORD_WEBHOOK_INFO_URL` に Secret の値を直接入れている（I-19）。
- そのため、dev の通知は Secret `var.discord_webhook_info_secret_name` の URL へ届く。
- 番組ごとの通知先はない。どの番組の処理も、同じチャンネルに届く。

### 時期と内容（`process_podcast_workflow.py`）

| 時期 | 送る内容 | 本文を含むか |
| --- | --- | --- |
| 文字起こしの直後（監査前） | `#番号 Meeting Transcript` ＋ **議事録全文** | **含む** |
| 要約の直後（監査前） | **タイトル・紹介文** | **含む** |
| ポリシー指摘があるとき | 番号と件数 | 含まない |
| 訂正提案があるとき | 番号、件数、**監査前のタイトル**、根拠URL | タイトルを含む |
| 再監査で新しい指摘がないとき | 番号と状態 | 含まない |
| 公開の完了後 | タイトル、公開URL | 公開済みの内容のみ |
| 失敗時 | `Error: {例外の文字列}` | 例外の内容しだい（外部APIの応答が入りうる） |

この他に、収録ミキサー（`mixer_main.py`）の失敗通知（`DISCORD_WEBHOOK_ERROR_URL`）と、週次アジェンダ（`agenda_main.py`、別の webhook）がある。どちらも監査の対象外。

### 現在の止め方

- コードには、通知を止める設定がない。止めるには、webhook URL を空にするしかない。
  - URL が空なら、`Notifier` は送信をとばす。ただし、本文の先頭20文字をログに出す。
- `job.tf` は Secret の値を必ず入れる。そのため、止めるには共有 dev のジョブ設定か Secret を変える必要がある（今回は変えない）。

### 最小変更の提案

- 送信内容の選び方を、環境変数 `DISCORD_NOTIFY_CONTENT` で切り替える。
- 既定は「状態だけ」にする。現状どおり本文も送るときは `true` にする。
- infra を変えなくても、提出用の環境では本文が送られなくなる。

```python
# apps/automator/app/src/usecases/process_podcast_workflow.py（案）
notify_content = os.environ.get("DISCORD_NOTIFY_CONTENT", "false").lower() == "true"

def _status(self, text: str, content: str | None = None) -> None:
    """状態だけを送る。本文は DISCORD_NOTIFY_CONTENT=true のときだけ付ける."""
    self._notifier.send_discord_message(message=f"{text}\n\n{content}" if (notify_content and content) else text)
```

| 箇所 | 変更後（既定） |
| --- | --- |
| 文字起こしの直後 | `#番号 文字起こしが完了しました（{n}文字）` |
| 要約の直後 | `#番号 要約を作成しました。監査を開始します` |
| 訂正提案 | `#番号 訂正提案が {n} 件あります。管理画面で確認してください`（タイトル・URLなし） |
| 公開の完了後 | 現状のまま（公開済みのタイトルとURL） |
| 失敗時 | `#番号 処理に失敗しました（{例外の型名}）`。詳細は Cloud Logging のみ |
| `Notifier` の URL 未設定時のログ | 本文の先頭20文字を出さない（文字数だけ） |

- 変更するのは `process_podcast_workflow.py` と `notifier.py` の2ファイル。テストは、V2-01 の期待を書き換えるだけにする。
- 既定を「状態だけ」に変えると、チームの運用（Discord で議事録を読む）が変わる。既定値はチームで決める。
- 既定を現状のままにする場合は、提出用の環境のジョブに `DISCORD_NOTIFY_CONTENT=false` を設定する（infra の変更が必要）。
