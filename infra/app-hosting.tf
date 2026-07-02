# Firebase App Hosting のランタイム SA（backend 作成時に App Hosting が自動作成する）への
# 権限付与。SA 本体は App Hosting 管理のため、ここでは binding のみ管理する。
locals {
  app_hosting_compute_sa = "firebase-app-hosting-compute@${var.project_id}.iam.gserviceaccount.com"
}

resource "google_project_iam_member" "app_hosting_compute" {
  for_each = toset(local.app_project_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${local.app_hosting_compute_sa}"
}

resource "google_storage_bucket_iam_member" "app_hosting_upload_object_creator" {
  bucket = var.upload_bucket
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${local.app_hosting_compute_sa}"
}

# 鍵なし（ADC）で GCS V4 署名付きURLを発行するには、SA 自身への signBlob 権限が必要。
resource "google_service_account_iam_member" "app_hosting_self_token_creator" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${local.app_hosting_compute_sa}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${local.app_hosting_compute_sa}"
}

# apphosting.yaml の secrets を参照するためのアクセス権。
# シークレット本体（値）は秘匿情報のため Terraform では管理しない（gcloud / Console で作成）。
resource "google_secret_manager_secret_iam_member" "app_hosting_secrets" {
  for_each = toset(["DB_PASSWORD", "CRON_SECRET"])

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.app_hosting_compute_sa}"
}
