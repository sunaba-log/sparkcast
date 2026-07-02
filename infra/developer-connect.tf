# App Hosting が GitHub リポジトリ（sunaba-log/podcast-ui）からビルドするための
# Developer Connect 連携。
#
# 接続本体（sunabalog-podcast-ui）は GitHub App の認可（人の操作）を伴うため
# Terraform では所有せず、作成済みのものを名前で参照する。
resource "google_project_service" "developerconnect" {
  project            = var.project_id
  service            = "developerconnect.googleapis.com"
  disable_on_destroy = false
}

# サービスエージェントを明示的にプロビジョニングして既定ロールを付与する
# （API 有効化直後は自動付与が間に合わず connection 作成が権限エラーになるため）。
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
