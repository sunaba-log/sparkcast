resource "google_storage_bucket" "input" {
  name     = lower("${local.automator_name_prefix}-audio-input-${var.environment}")
  location = var.region

  uniform_bucket_level_access = true

  force_destroy = var.gcs_force_destroy

  cors {
    origin          = var.gcs_cors_origins
    method          = ["PUT"]
    response_header = ["Content-Type"]
    max_age_seconds = 3600
  }

  dynamic "lifecycle_rule" {
    for_each = var.gcs_retention_days != null ? [1] : []
    content {
      condition {
        age = var.gcs_retention_days
      }
      action {
        type = "Delete"
      }
    }
  }
}

# Jev 入出力トレースログ保存用バケット（#220）
resource "google_storage_bucket" "audit_traces" {
  name     = lower("${local.automator_name_prefix}-audit-traces-${var.environment}")
  location = var.region

  uniform_bucket_level_access = true
  force_destroy               = var.gcs_force_destroy

  lifecycle_rule {
    condition {
      age = var.audit_trace_retention_days
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket_iam_member" "job_audit_traces_access" {
  bucket = google_storage_bucket.audit_traces.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${local.default_compute_service_account}"

  depends_on = [google_project_service.required]
}

