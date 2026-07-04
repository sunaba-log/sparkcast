# GitHub Actions から鍵ファイルなしで GCP へデプロイするための
# Workload Identity Federation とデプロイ用 SA。
resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }

  # このリポジトリの Actions からのみ認証を許可する
  attribute_condition = "assertion.repository == \"${var.github_repository}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "podcast-ui-deployer"
  display_name = "Podcast UI deployer (GitHub Actions)"
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

locals {
  deployer_project_roles = [
    "roles/run.developer",           # Cloud Run へのデプロイ・トラフィック更新
    "roles/artifactregistry.writer", # イメージの push
    "roles/cloudsql.client",         # デプロイ前のマイグレーション実行（Cloud SQL 接続）
    "roles/firebaseauth.admin",      # PR プレビュードメインを認可ドメインへ自動登録/削除
  ]
}

resource "google_project_iam_member" "deployer" {
  for_each = toset(local.deployer_project_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# デプロイ時にランタイム SA（podcast-ui-<env>）を割り当てるための権限。
resource "google_service_account_iam_member" "deployer_act_as_app" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

# マイグレーション実行時に DB パスワードを読むための権限。
resource "google_secret_manager_secret_iam_member" "deployer_db_password" {
  project   = var.project_id
  secret_id = data.google_secret_manager_secret.db_password.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.deployer.email}"
}

output "workload_identity_provider" {
  description = "GitHub Actions の google-github-actions/auth に渡す provider 名"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account" {
  description = "GitHub Actions が impersonate するデプロイ用 SA"
  value       = google_service_account.deployer.email
}
