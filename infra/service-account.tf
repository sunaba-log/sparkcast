# podcast-ui の実行用サービスアカウント。
# このSAの鍵を Vercel の FIREBASE_SERVICE_ACCOUNT_JSON に設定している。
# 鍵（google_service_account_key）は秘匿情報のため Terraform では管理しない。
resource "google_service_account" "app" {
  project      = var.project_id
  account_id   = var.app_service_account_id
  display_name = var.app_service_account_display_name
}
