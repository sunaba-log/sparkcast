module "cloud_run_job" {
  source = "./modules/google/docker_based_cloud_run_job"

  project_id                     = var.project_id
  region                         = var.region
  environment                    = var.environment
  system                         = local.automator_name_prefix
  image_name                     = "app"
  docker_context_path            = "${path.module}/../apps/automator/app"
  docker_build_command           = "make docker-build"
  docker_build_result_image_name = "podcast-automator-app:latest"
  job_name                       = "${local.automator_name_prefix}-app-${var.environment}"
  service_account_email          = local.default_compute_service_account

  # 動的文字起こしの待機に加え、Pydub/ffmpeg の音声差し替えを行うため余裕を持たせる（#173）。
  timeout            = "25200s"
  memory             = "12Gi"
  cpu                = "4"
  max_instance_count = 1

  environment_variables = {
    GCS_BUCKET = google_storage_bucket.input.name
    PROJECT_ID = var.project_id
    # TODO: remove DISCORD_WEBHOOK_INFO_URL; scheduled for deletion.
    DISCORD_WEBHOOK_INFO_URL = data.google_secret_manager_secret_version.discord_webhook_info.secret_data
    # TODO: remove DISCORD_WEBHOOK_ERROR_URL; scheduled for deletion.
    DISCORD_WEBHOOK_ERROR_URL         = data.google_secret_manager_secret_version.discord_webhook_error.secret_data
    DISCORD_WEBHOOK_INFO_SECRET_NAME  = var.discord_webhook_info_secret_name
    DISCORD_WEBHOOK_ERROR_SECRET_NAME = var.discord_webhook_error_secret_name
    R2_BUCKET                         = var.r2_bucket_name
    R2_KEY_PREFIX                     = var.r2_key_prefix
    R2_CUSTOM_DOMAIN                  = local.r2_custom_domain
    # TODO: remove CLOUDFLARE_ACCOUNT_ID; scheduled for deletion.
    CLOUDFLARE_ACCOUNT_ID    = var.cloudflare_account_id
    CLOUDFLARE_ACCESS_KEY_ID = data.google_secret_manager_secret_version.cloudflare_access_key_id.secret_data
    # TODO: remove CLOUDFLARE_SECRET_ACCESS_KEY; scheduled for deletion.
    CLOUDFLARE_SECRET_ACCESS_KEY             = data.google_secret_manager_secret_version.cloudflare_secret_access_key.secret_data
    CLOUDFLARE_ACCESS_KEY_ID_SECRET_NAME     = var.cloudflare_access_key_id_secret_name
    CLOUDFLARE_SECRET_ACCESS_KEY_SECRET_NAME = var.cloudflare_secret_access_key_secret_name
    PODCAST_ID                               = var.podcast_id
    SNS_SCHEDULE_OFFSET_HOURS                = var.sns_schedule_offset_hours
    # 話者・時刻つきの文字起こし（#166、transcription.tf）
    WORK_BUCKET     = google_storage_bucket.work.name
    SPEECH_LOCATION = "asia-northeast1"
    SPEECH_MODEL    = "long"
    # 1 分 $0.016 → $0.003。結果が出るまでの時間に保証は無いので、待つ上限を長めにする
    SPEECH_DYNAMIC_BATCH   = "true"
    SPEECH_TIMEOUT_SECONDS = "18000"
    # エピソードが完成したらチャット用の索引をすぐ作り直してもらう（#166。認証は定期実行と同じ CRON_SECRET）
    APP_BASE_URL = local.app_base_url
  }

  secret_environment_variables = {
    DATABASE_URL     = var.database_url_secret_name
    CRON_SECRET      = data.google_secret_manager_secret.cron_secret.secret_id
    JEV_API_KEY      = google_secret_manager_secret.jev_api_key.secret_id
    TYPESAFE_API_KEY = google_secret_manager_secret.jev_api_key.secret_id
  }

  depends_on = [
    google_project_service.required,
  ]
}
