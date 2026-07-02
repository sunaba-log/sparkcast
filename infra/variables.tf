variable "project_id" {
  type        = string
  description = "対象の GCP プロジェクト ID"
}

variable "region" {
  type        = string
  description = "google provider の既定リージョン"
  default     = "asia-northeast1"
}

variable "app_service_account_id" {
  type        = string
  description = "podcast-ui アプリ実行用サービスアカウントの account_id"
  default     = "podcast-ui-dev"
}

variable "app_service_account_display_name" {
  type        = string
  description = "アプリ実行用サービスアカウントの表示名"
  default     = "Podcast UI dev"
}

variable "upload_bucket" {
  type        = string
  description = "音声アップロード用 GCS バケット（署名付きURLのPUT先）"
}

variable "app_hosting_url" {
  type        = string
  description = "Firebase App Hosting backend のURL（例: https://podcast-ui--sunabalog-dev.<region>.hosted.app）。未設定の間は Cloud Scheduler ジョブを作成しない"
  default     = ""
}
