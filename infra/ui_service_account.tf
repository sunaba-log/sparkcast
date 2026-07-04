# podcast-ui の実行用（Cloud Run ランタイム）サービスアカウント。
# GCP 上では ADC で認証するため鍵は不要。GCP 外（ローカル等）で使う場合のみ
# 鍵を FIREBASE_SERVICE_ACCOUNT_JSON に設定する。鍵は秘匿情報のため
# Terraform では管理しない。
resource "google_service_account" "app" {
  project      = var.project_id
  account_id   = var.app_service_account_id
  display_name = var.app_service_account_display_name
}
