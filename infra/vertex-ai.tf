# 議事録チャット（RAG）は Vertex AI の Gemini（生成）と埋め込みモデルを使う。

resource "google_project_service" "aiplatform" {
  project = var.project_id
  service = "aiplatform.googleapis.com"

  # 他サービスも共有する API のため、destroy 時に無効化しない。
  disable_on_destroy = false
}

# アプリ SA に Vertex AI の呼び出し権限を付与する。
# これが無いと埋め込み（再インデックス）と生成（チャット）が 403 で失敗する。
resource "google_project_iam_member" "app_aiplatform_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${var.app_service_account_email}"

  depends_on = [google_project_service.aiplatform]
}
