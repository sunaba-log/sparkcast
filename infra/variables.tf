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

variable "app_hosting_location" {
  type        = string
  description = "Firebase App Hosting backend / Developer Connect のリージョン"
  default     = "asia-east1"
}

variable "firebase_web_app_id" {
  type        = string
  description = "backend に関連付ける Firebase ウェブアプリの appId（podcast-ui-dev）"
}
