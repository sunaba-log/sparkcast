# アプリが参照するシークレット。本体・値は既存（手動作成）のものを
# 参照のみ行い、Terraform では所有しない。
resource "google_project_service" "secretmanager" {
  project            = var.project_id
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

data "google_secret_manager_secret" "app" {
  for_each = toset(["db-password", "cron-secret", "firebase-api-key"])

  project   = var.project_id
  secret_id = each.value
}

resource "google_secret_manager_secret_iam_member" "app_secrets" {
  for_each = data.google_secret_manager_secret.app

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

# 鍵なし（ADC）で GCS V4 署名付きURLを発行するには、SA 自身への signBlob 権限が必要。
resource "google_service_account_iam_member" "app_self_token_creator" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.app.email}"
}
