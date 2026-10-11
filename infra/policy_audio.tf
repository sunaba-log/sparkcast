# Persistent review assets live outside the 7-day STT work bucket and Eventarc input bucket.
resource "google_storage_bucket" "policy_audio" {
  name                        = lower("${local.automator_name_prefix}-policy-audio-${var.environment}")
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = var.gcs_force_destroy
  depends_on                  = [google_project_service.required]
}

resource "google_storage_bucket_iam_member" "policy_audio_access" {
  for_each = { ui = google_service_account.app.email, worker = local.default_compute_service_account }
  bucket   = google_storage_bucket.policy_audio.name
  role     = "roles/storage.objectAdmin"
  member   = "serviceAccount:${each.value}"
}

resource "google_storage_bucket_iam_member" "speech_reads_policy_audio" {
  bucket = google_storage_bucket.policy_audio.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_project_service_identity.speech.email}"
}

resource "google_cloud_run_v2_service" "policy_media" {
  name                = "${local.automator_name_prefix}-policy-media-${var.environment}"
  location            = var.region
  project             = var.project_id
  deletion_protection = false
  template {
    service_account                  = local.default_compute_service_account
    timeout                          = "300s"
    max_instance_request_concurrency = 1
    scaling { max_instance_count = 2 }
    containers {
      image   = module.cloud_run_job.docker_image_name
      command = ["functions-framework"]
      args    = ["--source=src/policy_media_main.py", "--target=policy_media", "--port=8080"]
      resources { limits = { cpu = "2", memory = "4Gi" } }
      env {
        name  = "PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCS_BUCKET"
        value = google_storage_bucket.input.name
      }
      env {
        name  = "POLICY_AUDIO_BUCKET"
        value = google_storage_bucket.policy_audio.name
      }
      env {
        name = "JEV_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.jev_api_key.secret_id
            version = "latest"
          }
        }
      }
    }
  }
}
resource "google_cloud_run_v2_service_iam_member" "ui_invokes_policy_media" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.policy_media.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.app.email}"
}

resource "google_project_iam_member" "policy_media_api_consumer" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = "serviceAccount:${local.default_compute_service_account}"
}
