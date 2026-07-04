# アプリ SA に付与するプロジェクトロール一式。
# CD では Terraform がこの集合を真として権限を収束させる。
locals {
  app_project_roles = [
    "roles/cloudsql.client",    # Cloud SQL 接続（Cloud SQL Connector）
    "roles/datastore.user",     # Firestore 読み書き
    "roles/firebaseauth.admin", # セッションCookie検証 / Auth管理
    "roles/aiplatform.user",    # Vertex AI（議事録チャットの生成・埋め込み）
  ]
}

resource "google_project_iam_member" "app" {
  for_each = toset(local.app_project_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.app.email}"
}

# 署名付きURLでのアップロード（PUT）に必要なオブジェクト作成権限。
# バケット本体は共有リソースのため、ここでは付与（binding）のみを管理する。
resource "google_storage_bucket_iam_member" "app_upload_object_creator" {
  bucket = var.upload_bucket
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.app.email}"
}
