# ハッカソン審査用の凍結環境（Google Cloud Japan AI Hackathon vol.5）。
# 提出時点のコードを手動で apply / deploy するだけで、CD（cd.yml）からは配信しない。
# 審査（2026-12-01）が終わるまで、ここへの apply・deploy はしないこと。
environment = "stg"
# provider の default_labels 用のシステム名（実リソース名の接頭辞ではない）
system            = "sparkcast"
project_id        = "sunabalog-stg"
gcs_force_destroy = true
# backup は dev の Supabase と DB を共有するので、作り直しで消えないよう false
backup_bucket_force_destroy = false
automator_name_prefix       = "sparkcast-automator"
ui_name_prefix              = "sparkcast-ui"
gcs_retention_days          = 7
gcs_cors_origins = [
  "https://stg.sparkcast.sunabalog.com",
]
# Discord は dev のチャンネルへ通知する（webhook の値を dev から複製済み）
discord_webhook_info_secret_name   = "discord-webhook-url-stg-info"
discord_webhook_error_secret_name  = "discord-webhook-url-stg-error"
discord_webhook_agenda_secret_name = "discord-webhook-url-stg-agenda"
podcast_id                         = "1"
# DB は dev の Supabase プロジェクト内の別データベース（sparkcast_stg）
database_url_secret_name  = "supabase-database-url-stg"
cloudflare_account_id     = "8ed20f6872cea7c9219d68bfcf5f98ae"
cloudflare_zone_name      = "sunabalog.com"
r2_bucket_name            = "podcast-stg"
r2_subdomain              = "stg.podcast"
enable_promoter           = false
manage_firestore_database = true
budget_amount_jpy         = 10000

# sparkcast-ui（Cloud Run Service）
app_service_account_id           = "sparkcast-ui-stg"
app_service_account_display_name = "SparkCast UI stg"
custom_domain                    = "stg.sparkcast.sunabalog.com"
# 審査員はゲストアカウント（共有）で入る
enable_guest_mode = true
rate_limit_daily  = "200"
rate_limit_hourly = "50"
# 収録ルームはゲストが使えないので作らない（Cloudflare Realtime / Worker も不要）
enable_recording = false

audit_trace_enabled        = true
audit_trace_retention_days = 90
