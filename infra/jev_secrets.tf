# Jev API key の値は Terraform state に保存しない。初回 apply 後に
# `gcloud secrets versions add` で環境ごとの値を登録する。
resource "google_secret_manager_secret" "jev_api_key" {
  project   = var.project_id
  secret_id = var.jev_api_key_secret_name

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}
