# infra (Terraform)

podcast-ui が利用する GCP リソースを Terraform で管理する。state は共有の GCS
バケット `sunabalog-tfstate-dev`（prefix `podcast-ui/infra`）でリモート管理する。

## 管理対象（現在のスコープ）

サービス単位で podcast-ui 固有のリソースのみを管理する。プロジェクト全体で共有する
リソース（Cloud SQL インスタンス・ネットワーク等）はここでは扱わない。

- `aiplatform.googleapis.com` の有効化（議事録チャットの生成・埋め込み）
- アプリ SA（`podcast-ui-dev@…`）への `roles/aiplatform.user` 付与
- 議事録 RAG 用 Firestore ベクトルインデックス（`minutes_index` / 768次元 / COSINE）

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
次を実行してから apply する。

```bash
terraform import google_project_service.aiplatform "sunabalog-dev/aiplatform.googleapis.com"
terraform import google_firestore_index.minutes_index \
  "projects/sunabalog-dev/databases/(default)/collectionGroups/minutes_index/indexes/<INDEX_ID>"
```
