# 議事録チャット（RAG）は Vertex AI の Gemini（生成）と埋め込みモデルを使う。
# SA への呼び出し権限（roles/aiplatform.user）は iam.tf で付与する。
resource "google_project_service" "aiplatform" {
  project = var.project_id
  service = "aiplatform.googleapis.com"

  # 他サービスも共有する API のため、destroy 時に無効化しない。
  disable_on_destroy = false
}
