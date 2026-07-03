# [残置] Firebase App Hosting 検討時（#29 の旧方針・並行作業）由来のリソース。
# Cloud Run への方針変更により backend 等は撤去済み。以下は並行作業で作成された
# 無害な IAM・サービスエージェントのみ残しており、作業者と確認のうえ別途整理する。
resource "google_project_service" "firebaseapphosting" {
  project            = var.project_id
  service            = "firebaseapphosting.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service_identity" "apphosting" {
  provider = google-beta

  project = var.project_id
  service = "firebaseapphosting.googleapis.com"

  depends_on = [google_project_service.firebaseapphosting]
}

resource "google_project_iam_member" "app_hosting_runner" {
  project = var.project_id
  role    = "roles/firebaseapphosting.computeRunner"
  member  = "serviceAccount:${google_service_account.app.email}"
}

resource "google_service_account_iam_member" "app_hosting_agent_user" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_project_service_identity.apphosting.email}"
}
