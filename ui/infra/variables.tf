variable "project_id" {
  type        = string
  description = "対象の GCP プロジェクト ID"
}

variable "environment" {
  type        = string
  description = "環境名（dev / prod）。リソース名やサービス名のサフィックスに使う"
}

variable "region" {
  type        = string
  description = "google provider の既定リージョン"
  default     = "asia-northeast1"
}

variable "app_service_account_id" {
  type        = string
  description = "podcast-ui アプリ実行用サービスアカウントの account_id"
}

variable "app_service_account_display_name" {
  type        = string
  description = "アプリ実行用サービスアカウントの表示名"
}

variable "upload_bucket" {
  type        = string
  description = "音声アップロード用 GCS バケット（署名付きURLのPUT先）"
}

variable "cloud_sql_instance_connection_name" {
  type        = string
  description = "Cloud SQL インスタンス接続名（project:region:instance）"
}

variable "db_name" {
  type        = string
  description = "Cloud SQL データベース名"
  default     = "podcast"
}

variable "db_user" {
  type        = string
  description = "Cloud SQL 接続ユーザー"
  default     = "podcast_app"
}

variable "db_password_secret_id" {
  type        = string
  description = "DB 接続パスワードを保持する Secret Manager シークレット ID"
  default     = "db-password"
}

variable "cron_secret_id" {
  type        = string
  description = "cron エンドポイント保護用トークンの Secret Manager シークレット ID"
  default     = "cron-secret"
}

variable "custom_domain" {
  type        = string
  description = "Cloud Run に割り当てるカスタムドメイン（例: dev.sparkcast.sunabalog.com）"
}
