# Firebase App Hosting の backend（dev 環境）と、そのランタイム SA・シークレット。
# backend は GitHub（develop ブランチ）からの自動ロールアウトでデプロイされる。
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

# App Hosting のランタイム SA。既定名（firebase-app-hosting-compute@…）を明示的に管理する。
resource "google_service_account" "app_hosting_compute" {
  project      = var.project_id
  account_id   = "firebase-app-hosting-compute"
  display_name = "Firebase App Hosting compute service account"
}

# App Hosting のビルド・実行に必要な既定ロール。
resource "google_project_iam_member" "app_hosting_compute_runner" {
  project = var.project_id
  role    = "roles/firebaseapphosting.computeRunner"
  member  = "serviceAccount:${google_service_account.app_hosting_compute.email}"
}

# アプリが必要とするロール一式（iam.tf の app_project_roles を共用）。
resource "google_project_iam_member" "app_hosting_compute" {
  for_each = toset(local.app_project_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.app_hosting_compute.email}"
}

resource "google_storage_bucket_iam_member" "app_hosting_upload_object_creator" {
  bucket = var.upload_bucket
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.app_hosting_compute.email}"
}

# 鍵なし（ADC）で GCS V4 署名付きURLを発行するには、SA 自身への signBlob 権限が必要。
resource "google_service_account_iam_member" "app_hosting_self_token_creator" {
  service_account_id = google_service_account.app_hosting_compute.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.app_hosting_compute.email}"
}

# apphosting.yaml が参照するシークレット。メタデータのみ管理し、
# 値（バージョン）は秘匿情報のため Terraform では管理しない:
#   printf '%s' '<value>' | gcloud secrets versions add DB_PASSWORD --data-file=-
resource "google_secret_manager_secret" "app" {
  for_each = toset(["DB_PASSWORD", "CRON_SECRET"])

  project   = var.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_iam_member" "app_hosting_secrets" {
  for_each = google_secret_manager_secret.app

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app_hosting_compute.email}"
}

# backend 本体。GitHub リポジトリと Firebase ウェブアプリ（podcast-ui-dev）を関連付ける。
resource "google_firebase_app_hosting_backend" "podcast_ui" {
  project          = var.project_id
  location         = var.app_hosting_location
  backend_id       = "podcast-ui"
  app_id           = var.firebase_web_app_id
  serving_locality = "GLOBAL_ACCESS"
  service_account  = google_service_account.app_hosting_compute.email

  codebase {
    repository     = google_developer_connect_git_repository_link.podcast_ui.id
    root_directory = "/"
  }

  depends_on = [
    google_project_service.firebaseapphosting,
    google_project_iam_member.app_hosting_compute_runner,
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
