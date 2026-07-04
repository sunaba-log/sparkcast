# アプリが参照するシークレット。本体・値は既存（手動作成）のものを
# 参照のみ行い、Terraform では所有しない。
resource "google_project_service" "secretmanager" {
  project            = var.project_id
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

# Cloud Run が実行時に参照するシークレット（DB パスワードと cron トークン）。
# NEXT_PUBLIC_FIREBASE_API_KEY はビルド時にワークフローで埋め込むためここには含めない。
data "google_secret_manager_secret" "db_password" {
  project   = var.project_id
  secret_id = var.db_password_secret_id
}

data "google_secret_manager_secret" "cron_secret" {
  project   = var.project_id
  secret_id = var.cron_secret_id
}

resource "google_secret_manager_secret_iam_member" "app_secrets" {
  for_each = {
    db_password = data.google_secret_manager_secret.db_password.secret_id
    cron_secret = data.google_secret_manager_secret.cron_secret.secret_id
  }

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

# 鍵なし（ADC）で GCS V4 署名付きURLを発行するには、SA 自身への signBlob 権限が必要。
resource "google_service_account_iam_member" "app_self_token_creator" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.app.email}"
}
