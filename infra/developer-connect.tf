# [残置] Developer Connect の GitHub 連携（並行作業由来）。
# Cloud Run + GitHub Actions への方針変更により新規利用はしない。
# 接続本体（sunabalog-podcast-ui）は Terraform 外で作成済みのものが残っている。
# 作業者と確認のうえ、接続・リンクごと撤去を検討する。
resource "google_project_service" "developerconnect" {
  project            = var.project_id
  service            = "developerconnect.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service_identity" "developerconnect" {
  provider = google-beta

  project = var.project_id
  service = "developerconnect.googleapis.com"

  depends_on = [google_project_service.developerconnect]
}

resource "google_project_iam_member" "developerconnect_service_agent" {
  project = var.project_id
  role    = "roles/developerconnect.serviceAgent"
  member  = "serviceAccount:${google_project_service_identity.developerconnect.email}"
}

resource "google_developer_connect_git_repository_link" "default" {
  project                = var.project_id
  location               = var.app_hosting_location
  parent_connection      = "sunabalog-podcast-ui"
  git_repository_link_id = "podcast-ui-repo"
  clone_uri              = "https://github.com/sunaba-log/podcast-ui.git"
}
