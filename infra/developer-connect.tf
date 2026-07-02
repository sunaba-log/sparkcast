# App Hosting が GitHub リポジトリ（sunaba-log/podcast-ui）からビルドするための
# Developer Connect 連携。
#
# App Hosting の backend は「Firebase GitHub App」で作成した接続のみ使用できる
# （既存の sunabalog-podcast-ui は DEVELOPER_CONNECT App 製のため使用不可）。
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

# 旧接続（DEVELOPER_CONNECT App 製）配下のリンク。App Hosting では使用しない。
# 撤去は並行作業者と確認のうえ別途行う。
resource "google_developer_connect_git_repository_link" "default" {
  project                = var.project_id
  location               = var.app_hosting_location
  parent_connection      = "sunabalog-podcast-ui"
  git_repository_link_id = "podcast-ui-repo"
  clone_uri              = "https://github.com/sunaba-log/podcast-ui.git"
}

# Firebase GitHub App 製の接続。作成後、初回のみ GitHub App の認可（人の操作）が必要:
#   terraform output github_connection_action_uri
resource "google_developer_connect_connection" "firebase_github" {
  project       = var.project_id
  location      = var.app_hosting_location
  connection_id = "podcast-ui-firebase-github"

  github_config {
    github_app = "FIREBASE"
  }

  depends_on = [google_project_iam_member.developerconnect_service_agent]
}

output "github_connection_action_uri" {
  description = "GitHub App の初回認可 URL（PENDING の間のみ有効）"
  value       = google_developer_connect_connection.firebase_github.installation_state[0].action_uri
}

resource "google_developer_connect_git_repository_link" "podcast_ui" {
  project                = var.project_id
  location               = var.app_hosting_location
  parent_connection      = google_developer_connect_connection.firebase_github.connection_id
  git_repository_link_id = "podcast-ui"
  clone_uri              = "https://github.com/sunaba-log/podcast-ui.git"
}
