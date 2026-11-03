output "sparkcast_ui_service_account_email" {
  description = "Service account used by the sparkcast ui (Cloud Run Service) runtime."
  value       = google_service_account.app.email
}

output "audit_traces_bucket_name" {
  description = "GCS bucket name for Jev audit trace logs (#220)."
  value       = google_storage_bucket.audit_traces.name
}

