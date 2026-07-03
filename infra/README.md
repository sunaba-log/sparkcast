# infra (Terraform)

podcast-ui が利用する GCP リソースを Terraform で管理する。**環境（dev / prod）は
プロジェクト単位で分離**し、それぞれ別の state バケットでリモート管理する
（dev=`sunabalog-tfstate-dev` / prod=`sunabalog-tfstate-prod`、prefix `podcast-ui/infra`）。
環境固有の値は `environments/<env>/{backend.conf,variables.tfvars}` に置く。

## 管理対象（現在のスコープ）

サービス単位で podcast-ui 固有のリソース（アプリの identity と権限）を管理する。
CD から `terraform apply` するだけで再現・収束できる状態にする。

- アプリ実行用 SA `google_service_account.app`（`podcast-ui-<env>@…`）
- アプリ SA のプロジェクトロール `google_project_iam_member.app`
  - `roles/cloudsql.client` / `roles/datastore.user` / `roles/firebaseauth.admin` / `roles/aiplatform.user`
- アプリ SA のアップロードバケット権限 `google_storage_bucket_iam_member.app_upload_object_creator`
  （`roles/storage.objectCreator`、binding のみ管理）
- Cloud Run サービス `podcast-ui-<env>`（`cloud-run.tf`。env / Secret Manager 参照 /
  公開アクセス。イメージ・リビジョン・トラフィックのデプロイは GitHub Actions が
  行うため `ignore_changes`）
- Artifact Registry リポジトリ `podcast-ui`（`cloud-run.tf`）
- GitHub Actions 用の Workload Identity Federation + デプロイ用 SA
  `podcast-ui-deployer@…`（`github-actions.tf`）
- 実行時シークレット（DB パスワード / cron トークン）への
  アクセス権付与（`secrets.tf`。シークレット本体・値は所有しない。secret_id は
  `db_password_secret_id` / `cron_secret_id` で環境ごとに指定）
- Cloud Scheduler の cron ジョブ（`cloud-scheduler.tf`。宛先は Cloud Run）
- `aiplatform.googleapis.com` ほか各 API の有効化 / ドメイン制限共有の解除（org policy）
- 議事録 RAG 用 Firestore ベクトルインデックス（`minutes_index` / 768次元 / COSINE）

プロジェクト全体で共有する基盤リソース（Cloud SQL インスタンス本体・GCS バケット本体・
Firestore データベース等）はここでは所有しない（共有のため dev-platform 側での管理を想定）。
SA 鍵とシークレットの値は秘匿情報のため Terraform では管理しない。

## 使い方

リポジトリルートの `make` から実行する。terraform は Docker コンテナ
（`infra/Dockerfile`）上で動く。**`ENVIRONMENT`（dev / prod、既定 dev）で対象環境を
切り替える**（backend と変数ファイルが切り替わる）。

```bash
make terraform-plan ENVIRONMENT=dev
make terraform-apply ENVIRONMENT=prod
make terraform-validate            # fmt チェック + validate
```

認証は Application Default Credentials（`~/.config/gcloud` をコンテナへ
read-only マウント）を使う。未設定なら次を実行する。

```bash
gcloud auth application-default login
```

### prod の初回構築（手動の前提）

apply 前に prod 側で次を用意する（値はチャットや docs に貼らない）。

- Secret Manager: `cron-secret`（新規生成）。DB パスワードは既存の
  `podcast-automator-database-password-prod` を参照するため作成不要
- Firebase Auth の承認済みドメインへ prod の Cloud Run URL を追加
- OAuth 同意画面の公開設定（外部 / 本番）を確認

### デプロイの仕組み

アプリのビルド・デプロイは GitHub Actions（`.github/workflows/`）が行う。
Terraform はサービス定義と CI 用の認証（WIF）だけを管理し、初回 apply では
プレースホルダイメージで Cloud Run サービスを作成する（最初の develop push で
実イメージに置き換わる）。Firebase Auth の承認済みドメインへの Cloud Run URL
追加は Console での手作業。

## 変数

`terraform.tfvars` で指定する。

| 変数 | 説明 |
|---|---|
| `project_id` | 対象 GCP プロジェクト |
| `region` | provider 既定リージョン |
| `upload_bucket` | 音声アップロード用 GCS バケット |
| `app_hosting_location` | App Hosting / Developer Connect のリージョン（既定 `asia-east1`） |
| `firebase_web_app_id` | backend に関連付ける Firebase ウェブアプリの appId |

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
