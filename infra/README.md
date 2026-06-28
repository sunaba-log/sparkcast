# infra (Terraform)

podcast-ui が利用する GCP リソースを Terraform で管理する。state は共有の GCS
バケット `sunabalog-tfstate-dev`（prefix `podcast-ui/infra`）でリモート管理する。

## 管理対象（現在のスコープ）

サービス単位で podcast-ui 固有のリソース（アプリの identity と権限）を管理する。
将来 CD から `terraform apply` するだけで再現・収束できる状態にする。

- アプリ実行用 SA `google_service_account.app`（`podcast-ui-dev@…`）
- アプリ SA のプロジェクトロール `google_project_iam_member.app`
  - `roles/cloudsql.client` / `roles/datastore.user` / `roles/firebaseauth.admin` / `roles/aiplatform.user`
- アプリ SA のアップロードバケット権限 `google_storage_bucket_iam_member.app_upload_object_creator`
  （`roles/storage.objectCreator`、binding のみ管理）
- `aiplatform.googleapis.com` の有効化
- 議事録 RAG 用 Firestore ベクトルインデックス（`minutes_index` / 768次元 / COSINE）

プロジェクト全体で共有する基盤リソース（Cloud SQL インスタンス本体・GCS バケット本体・
Firestore データベース等）はここでは所有しない（共有のため dev-platform 側での管理を想定）。
SA 鍵（`FIREBASE_SERVICE_ACCOUNT_JSON`）は秘匿情報のため Terraform では管理しない。

## 使い方

```bash
cd infra
terraform init
terraform plan
terraform apply
```

認証は Application Default Credentials を使う。未設定なら次を実行する。

```bash
gcloud auth application-default login
```

## 変数

`terraform.tfvars` で指定する。

| 変数 | 説明 |
|---|---|
| `project_id` | 対象 GCP プロジェクト |
| `region` | provider 既定リージョン |
| `app_service_account_email` | アプリ実行用 SA |

## 既存リソースの取り込み

手動・gcloud で先行作成したリソースは import 済み。新環境で state を作り直す場合は
次を実行してから apply する（`<INDEX_ID>` は `gcloud firestore indexes composite list` で確認）。

```bash
SA=podcast-ui-dev@sunabalog-dev.iam.gserviceaccount.com
terraform import google_service_account.app "projects/sunabalog-dev/serviceAccounts/$SA"
terraform import google_project_service.aiplatform "sunabalog-dev/aiplatform.googleapis.com"
for ROLE in roles/cloudsql.client roles/datastore.user roles/firebaseauth.admin roles/aiplatform.user; do
  terraform import "google_project_iam_member.app[\"$ROLE\"]" "sunabalog-dev $ROLE serviceAccount:$SA"
done
terraform import google_storage_bucket_iam_member.app_upload_object_creator \
  "b/podcast-automator-audio-input-dev roles/storage.objectCreator serviceAccount:$SA"
terraform import google_firestore_index.minutes_index \
  "projects/sunabalog-dev/databases/(default)/collectionGroups/minutes_index/indexes/<INDEX_ID>"
```
