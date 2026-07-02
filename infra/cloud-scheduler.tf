# vercel.json の crons から移行した定期実行ジョブ。
# スケジュールは Vercel Cron（UTC）当時の実行時刻を維持する。
resource "google_project_service" "cloudscheduler" {
  project            = var.project_id
  service            = "cloudscheduler.googleapis.com"

  # 他サービスも共有する API のため、destroy 時に無効化しない。
  disable_on_destroy = false
}

# アプリ側の検証と同じ Bearer トークンを Scheduler のヘッダに設定する。
# 値のバージョンは gcloud で投入しておくこと（app-hosting.tf のコメント参照）。
data "google_secret_manager_secret_version" "cron_secret" {
  project = var.project_id
  secret  = google_secret_manager_secret.app["CRON_SECRET"].secret_id
}

locals {
  cron_jobs = {
    cleanup-uploads = {
      path        = "/api/cron/cleanup-uploads"
      schedule    = "0 3 * * *"
      description = "放置された upload_pending エピソードを failed へ更新する"
    }
    reindex-minutes = {
      path        = "/api/cron/reindex-minutes"
      schedule    = "0 4 * * *"
      description = "議事録RAGの埋め込みインデックスを全チャンネル分更新する"
    }
  }

  # backend の uri はスキーム無しのホスト名で返るため補完する。
  app_hosting_base_url = "https://${trimprefix(google_firebase_app_hosting_backend.podcast_ui.uri, "https://")}"
}

resource "google_cloud_scheduler_job" "cron" {
  for_each = local.cron_jobs

  project     = var.project_id
  region      = var.region
  name        = "podcast-ui-${each.key}"
  description = each.value.description
  schedule    = each.value.schedule
  time_zone   = "Etc/UTC"

  http_target {
    http_method = "GET"
    uri         = "${local.app_hosting_base_url}${each.value.path}"
    headers = {
      Authorization = "Bearer ${data.google_secret_manager_secret_version.cron_secret.secret_data}"
    }
  }

  retry_config {
    retry_count = 1
  }

  depends_on = [google_project_service.cloudscheduler]
}
