# App Hosting が GitHub リポジトリ（sunaba-log/podcast-ui）からビルドするための
# Developer Connect 連携。
#
# 注意: connection 作成後、GitHub App の認可（初回のみ手動）が必要。
# `terraform output github_connection_action_uri` の URL をブラウザで開いて
# Firebase App Hosting の GitHub App を sunaba-log org にインストールする。
# 認可が完了するまで git_repository_link / backend の apply は失敗する。
resource "google_project_service" "developerconnect" {
  project            = var.project_id
  service            = "developerconnect.googleapis.com"
  disable_on_destroy = false
}

resource "google_developer_connect_connection" "github" {
  project       = var.project_id
  location      = var.app_hosting_location
  connection_id = "podcast-ui-github"

  github_config {
    github_app = "FIREBASE"
  }

  depends_on = [google_project_service.developerconnect]
}

output "github_connection_action_uri" {
  description = "GitHub App の初回認可 URL（PENDING の間のみ有効）"
  value       = google_developer_connect_connection.github.installation_state[0].action_uri
}

resource "google_developer_connect_git_repository_link" "podcast_ui" {
  project                = var.project_id
  location               = var.app_hosting_location
  parent_connection      = google_developer_connect_connection.github.connection_id
  git_repository_link_id = "podcast-ui"
  clone_uri              = "https://github.com/sunaba-log/podcast-ui.git"
}
