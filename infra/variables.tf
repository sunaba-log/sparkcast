variable "project_id" {
  type        = string
  description = "対象の GCP プロジェクト ID"
}

variable "region" {
  type        = string
  description = "google provider の既定リージョン"
  default     = "asia-northeast1"
}

variable "app_service_account_email" {
  type        = string
  description = "podcast-ui アプリ実行用のサービスアカウント（Vercel の FIREBASE_SERVICE_ACCOUNT_JSON に設定しているもの）"
}
