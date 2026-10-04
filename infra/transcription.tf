# 話者・時刻つきの文字起こし（#166）。全エピソードの処理（app Job）で使う。
#
# - Speech-to-Text v2 の Chirp 2（us-central1）で、時刻つきの発話を作る。
# - BatchRecognize は Speech のサービスエージェントが GCS を読むので、入力バケットと作業用バケットの
#   閲覧権限をサービスエージェントに付ける。
# - 作業用バケット: ブラウザ収録の話者別トラック（mixer が置き、app Job が話者ごとに認識する）。
#   入力バケットに置くと既存パイプラインが起動してしまうため、別バケットにする。7 日で削除。

resource "google_storage_bucket" "work" {
  name     = lower("${local.automator_name_prefix}-work-${var.environment}")
  location = var.region

  uniform_bucket_level_access = true
  force_destroy               = var.gcs_force_destroy

  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket_iam_member" "job_work_access" {
  bucket = google_storage_bucket.work.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${local.default_compute_service_account}"
}

# app Job（と mixer）が Speech-to-Text を呼ぶ
resource "google_project_iam_member" "job_speech_client" {
  project = var.project_id
  role    = "roles/speech.client"
  member  = "serviceAccount:${local.default_compute_service_account}"

  depends_on = [google_project_service.required]
}

resource "google_project_service_identity" "speech" {
  provider = google-beta
  project  = var.project_id
  service  = "speech.googleapis.com"

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket_iam_member" "speech_reads_input" {
  bucket = google_storage_bucket.input.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_project_service_identity.speech.email}"
}

resource "google_storage_bucket_iam_member" "speech_reads_work" {
  bucket = google_storage_bucket.work.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_project_service_identity.speech.email}"
}
