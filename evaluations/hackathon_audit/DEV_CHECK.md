# dev 実環境の確認手順（読み取りのみ・利用者のPCで実行）

dev（`sunabalog-dev`）の現状を、設定を変えずに確認する。秘密の値は表示しない。表示するのは「あり／なし」・列の定義・イメージのタグだけにする。

- zsh では、コマンド行の途中に `#` のコメントを書かない（下のコマンドはコメントなし）。
- 結果をチャットに貼るときは、出力をそのまま貼ってよい。ただし、URL・接続文字列・キーが出たら貼らずに知らせる。

## 0. 接続先の確認

```bash
gcloud config get-value project
gcloud projects describe sunabalog-dev --format='value(projectId,lifecycleState)'
```

1行目が `sunabalog-dev` でなければ、以降は実行しない。名前が dev でも、本番の資源を指していないかを確認する。

## 1. `episodes.status` の列定義（I-01）と migrations の適用状況

DB の接続文字列は画面に出さず、読み取り専用のトランザクションで実行する。

```bash
DBURL="$(gcloud secrets versions access latest --secret=supabase-database-url-dev --project=sunabalog-dev)"
PGOPTIONS='-c default_transaction_read_only=on' psql "$DBURL" -At -c "SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_schema='public' AND table_name='episodes' AND column_name IN ('status','episode_number') ORDER BY 1"
PGOPTIONS='-c default_transaction_read_only=on' psql "$DBURL" -At -c "SELECT migration_name FROM schema_migrations ORDER BY migration_name DESC LIMIT 5"
PGOPTIONS='-c default_transaction_read_only=on' psql "$DBURL" -At -c "SELECT status, count(*) FROM episodes GROUP BY status ORDER BY 1"
unset DBURL
```

`psql` がない場合は、`brew install libpq` の後に `$(brew --prefix libpq)/bin/psql` を使う。

| 結果 | 判断 |
| --- | --- |
| `status` が `character varying\|20` | I-01 は dev でも起きる（全却下→原音声公開ができない） |
| `status` が 29 以上 | 手動で変更済み。015 の適用は無害（広げるだけ） |
| `episode_number` の行がある | 016 がすでに適用されている（PR プレビューなどによる） |
| 015・016 が `schema_migrations` にある | 修正の migrations が dev に適用済み |

3つ目のクエリは状態ごとの件数だけを表示する。内容は表示しない。

## 2. `AUDIO_EDITOR_URL` の有無（I-04）と、Discord 通知先の設定方式（I-19）

値は表示せず、変数名があるかと、平文か Secret 参照かだけを表示する。

```bash
gcloud run services describe sparkcast-ui-dev --region=asia-northeast1 --project=sunabalog-dev --format=json | python3 -c 'import json,sys; d=json.load(sys.stdin); env={e["name"]: ("secret" if "valueFrom" in e else "plain") for c in d["spec"]["template"]["spec"]["containers"] for e in c.get("env",[])}; print("UI AUDIO_EDITOR_URL:", env.get("AUDIO_EDITOR_URL","なし"))'
gcloud run jobs describe sparkcast-automator-app-dev --region=asia-northeast1 --project=sunabalog-dev --format=json | python3 -c 'import json,sys; d=json.load(sys.stdin); cs=d["spec"]["template"]["spec"]["template"]["spec"]["containers"]; env={e["name"]: ("secret" if "valueFrom" in e else "plain") for c in cs for e in c.get("env",[])}; [print("JOB", k+":", env.get(k,"なし")) for k in ("AUDIO_EDITOR_URL","DISCORD_WEBHOOK_INFO_URL","SECRET_NAME","DISCORD_NOTIFY_CONTENT","AUDIT_TRACE_ENABLED")]'
```

- `UI AUDIO_EDITOR_URL: なし`：修正前の訂正介入パネルは、dev でも 503 になっていた（I-04 の再現と一致）。
- `JOB DISCORD_WEBHOOK_INFO_URL: plain`：通知先 URL が平文の環境変数になっている（I-19）。

## 3. 配備されているコミット

UI はイメージのタグがコミットSHAになっている（`cd.yml`）。自動処理ジョブのイメージは digest で管理されているため、GitHub Actions の実行履歴から確認する。

```bash
gcloud run services describe sparkcast-ui-dev --region=asia-northeast1 --project=sunabalog-dev --format='value(spec.template.spec.containers[0].image)'
gcloud run services describe sparkcast-ui-dev --region=asia-northeast1 --project=sunabalog-dev --format='table(status.traffic[].revisionName,status.traffic[].percent,status.traffic[].tag)'
gcloud run jobs describe sparkcast-automator-app-dev --region=asia-northeast1 --project=sunabalog-dev --format='value(spec.template.spec.template.spec.containers[0].image,metadata.annotations."run.googleapis.com/lastModifier")'
gh run list --repo sunaba-log/sparkcast --workflow=cd.yml --branch=develop --status=success --limit=5 --json headSha,createdAt,displayTitle
```

- 1行目の `:` 以降が、UI に配備されたコミット。
- 2行目で、`pr-<番号>` タグのプレビューがあるかを確認する（あれば、その PR の migrations が dev DB に先行適用されている）。
- 自動処理ジョブは、4行目のうち `apps/automator/**` か `infra/**` を変更した最新の成功実行が、配備されたコミット。
- 3行目の最終更新者が、CI のサービスアカウントか個人かを確認する。個人なら手動で apply された可能性がある。

## 4. STT 用の検証専用バケット

### 4.1 既存のバケットを確認する（読み取りのみ）

```bash
gcloud storage buckets list --project=sunabalog-dev --format='table(name,location,public_access_prevention,uniform_bucket_level_access,labels)'
```

既存の共有バケットは使わない：

- `sparkcast-automator-audio-input-dev`：アップロードで自動処理ジョブが起動する（Eventarc）。合成音声を置くと、dev の処理・通知が動く。
- work・policy-audio・audit-traces：dev アプリが使う共有バケット。

`eval` などの名前で、検証専用のバケットがすでにあり、次の条件をすべて満たせば、それを使う：

- `public_access_prevention` が `enforced`
- `uniform_bucket_level_access` が `True`
- IAM に `allUsers`・`allAuthenticatedUsers` がない

### 4.2 なければ作る（dev の既存設定は変えない。資源を1つ追加する）

- バケットを1つ追加するだけで、共有の設定は変更しない。
- Terraform の管理外なので、`terraform apply` の対象にもならない。
- 作る前に、チームへ一言伝える。

```bash
B="sunabalog-dev-eval-stt-$(date +%Y%m%d)"
gcloud storage buckets create "gs://$B" --project=sunabalog-dev --location=asia-northeast1 --uniform-bucket-level-access --public-access-prevention --soft-delete-duration=0 --default-storage-class=STANDARD
printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":1}}]}' > /tmp/eval-lifecycle.json
gcloud storage buckets update "gs://$B" --lifecycle-file=/tmp/eval-lifecycle.json --update-labels=purpose=hackathon-eval,data=synthetic
PN="$(gcloud projects describe sunabalog-dev --format='value(projectNumber)')"
gcloud storage buckets add-iam-policy-binding "gs://$B" --member="serviceAccount:service-$PN@gcp-sa-speech.iam.gserviceaccount.com" --role=roles/storage.objectViewer
gcloud storage buckets describe "gs://$B" --format='yaml(name,location,public_access_prevention,uniform_bucket_level_access,lifecycle_config,soft_delete_policy,labels)'
gcloud storage buckets get-iam-policy "gs://$B" --format='table(bindings.role,bindings.members)'
echo "$B"
```

- **公開しない**：`--public-access-prevention` で、公開の設定ができなくなる。
- **権限は最小限**：
  - 追加する権限は、Speech-to-Text のサービスエージェントへの読み取り権限だけ。
  - 評価ハーネスは、文字起こしの結果を応答で受け取る（GCS に書き出さない）。そのため、読み取り権限だけで足りる。
  - 書き込みは、実行者本人の権限で行う。
- **短期保持**：
  - ハーネスは、文字起こしが終わるたびにオブジェクトを削除する。
  - 削除し損ねても、1日で自動削除される。
  - 削除済みオブジェクトの保持（soft delete）は0日にする。
- **確認**：最後の `get-iam-policy` に、`allUsers`・`allAuthenticatedUsers` が出ないこと。
  - ハーネスも、実行前に同じ確認をする。公開されていれば中止する。

評価が終わったら、バケットごと削除する：

```bash
gcloud storage rm --recursive "gs://$B"
```
