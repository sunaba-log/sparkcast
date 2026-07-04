# podcast-ui アプリが参照するシークレットの権限付与。
# DB パスワードは同一 state の automator 管理シークレット
# （google_secret_manager_secret.database_password）を直接参照する。
# cron トークンは手動管理シークレットのため data source で参照する。

data "google_secret_manager_secret" "cron_secret" {
  project   = var.project_id
  secret_id = var.cron_secret_id
}

resource "google_secret_manager_secret_iam_member" "app_secrets" {
  for_each = {
    db_password = google_secret_manager_secret.database_password.secret_id
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
