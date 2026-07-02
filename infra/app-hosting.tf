# Firebase App Hosting の backend（dev 環境）。GitHub（develop ブランチ）からの
# 自動ロールアウトでデプロイされ、ランタイム SA には既存のアプリ SA
# （podcast-ui-dev@…）を使う。
data "google_project" "project" {
  project_id = var.project_id
}

resource "google_project_service" "firebaseapphosting" {
  project            = var.project_id
  service            = "firebaseapphosting.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "secretmanager" {
  project            = var.project_id
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

# App Hosting のサービスエージェントを明示的にプロビジョニングする。
resource "google_project_service_identity" "apphosting" {
  provider = google-beta

  project = var.project_id
  service = "firebaseapphosting.googleapis.com"

  depends_on = [google_project_service.firebaseapphosting]
}

# アプリ SA を App Hosting のランタイム SA として使うためのロール。
resource "google_project_iam_member" "app_hosting_runner" {
  project = var.project_id
  role    = "roles/firebaseapphosting.computeRunner"
  member  = "serviceAccount:${google_service_account.app.email}"
}

# App Hosting のサービスエージェントがアプリ SA で Cloud Run をデプロイするための権限。
resource "google_service_account_iam_member" "app_hosting_agent_user" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_project_service_identity.apphosting.email}"
}

# 鍵なし（ADC）で GCS V4 署名付きURLを発行するには、SA 自身への signBlob 権限が必要。
resource "google_service_account_iam_member" "app_self_token_creator" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.app.email}"
}

# apphosting.yaml が参照するシークレット。本体・値は既存（手動作成）のものを
# 参照のみ行い、Terraform では所有しない。
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

# backend 本体。GitHub リポジトリと Firebase ウェブアプリ（podcast-ui-dev）を関連付ける。
resource "google_firebase_app_hosting_backend" "podcast_ui" {
  project          = var.project_id
  location         = var.app_hosting_location
  backend_id       = "podcast-ui"
  app_id           = var.firebase_web_app_id
  serving_locality = "GLOBAL_ACCESS"
  service_account  = google_service_account.app.email

  codebase {
    repository     = google_developer_connect_git_repository_link.podcast_ui.id
    root_directory = "/"
  }

  depends_on = [
    google_project_iam_member.app_hosting_runner,
    google_service_account_iam_member.app_hosting_agent_user,
  ]
}

# develop への push で自動ロールアウトする（dev 環境の live branch）。
resource "google_firebase_app_hosting_traffic" "podcast_ui" {
  project  = var.project_id
  location = var.app_hosting_location
  backend  = google_firebase_app_hosting_backend.podcast_ui.backend_id

  rollout_policy {
    codebase_branch = "develop"
  }
}

output "app_hosting_uri" {
  description = "App Hosting backend の URL"
  value       = google_firebase_app_hosting_backend.podcast_ui.uri
}
