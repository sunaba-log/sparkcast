# ブラウザ収録ルーム（#166）。
#
# - R2 recordings バケット: 録音チャンク・台帳・話者別トラック（30 日で削除）。公開ドメインは付けない
# - Cloudflare Realtime SFU / TURN のアプリ（restapi provider で管理。下のコメント参照）
# - ルーム JWT と UI → Worker の service JWT の秘密（UI と Worker で共有）
# - mixer Job（app と同じイメージ、command で mixer_main を起動）と、UI からの起動権限
#
# Worker 本体（apps/realtime）は wrangler で CD がデプロイし、secret は下の
# sparkcast-recording-worker-secrets（JSON）を `wrangler secret bulk` で入れる。
#
# 使えるのは admin と制限を解除したユーザー（番組の仲間）だけで、運営者の番組の収録に使う
# （自己の需要。電気通信事業にあたらない）。判断の根拠は ADR 20261006-recording-room-private-use。

locals {
  recording_enabled        = var.enable_recording ? 1 : 0
  recordings_bucket_name   = "sparkcast-recordings-${var.environment}"
  recording_mixer_job_name = "${local.automator_name_prefix}-mixer-${var.environment}"
}

resource "cloudflare_r2_bucket" "recordings" {
  count      = local.recording_enabled
  account_id = var.cloudflare_account_id
  name       = local.recordings_bucket_name
}

resource "cloudflare_r2_bucket_lifecycle" "recordings" {
  count       = local.recording_enabled
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.recordings[0].name
  rules = [
    {
      id         = "expire-recording-sessions"
      enabled    = true
      conditions = { prefix = "sessions/" }
      delete_objects_transition = {
        condition = { type = "Age", max_age = 30 * 24 * 60 * 60 }
      }
      abort_multipart_uploads_transition = {
        condition = { type = "Age", max_age = 24 * 60 * 60 }
      }
    },
  ]
}

# Realtime の SFU アプリと TURN の鍵。
# cloudflare provider（v5.26 で確認）の cloudflare_calls_sfu_app / cloudflare_calls_turn_app は、作成後の refresh で
# 「missing required app_id / key_id parameter」になり、TURN の鍵の値も取れない（API が key でなく secret で返すため）。
# そのため Cloudflare の API を restapi provider で直接扱う。値（secret）は作成時の応答にしか無いので
# create_response から読み、下の Worker 用の秘密 JSON に書く。
resource "restapi_object" "realtime_sfu_app" {
  count                     = local.recording_enabled
  provider                  = restapi.cloudflare
  path                      = "/calls/apps"
  data                      = jsonencode({ name = "sparkcast-recording-${var.environment}" })
  ignore_all_server_changes = true

  lifecycle {
    precondition {
      condition     = var.cloudflare_api_token != ""
      error_message = "TF_VAR_cloudflare_api_token is required to manage the Realtime apps."
    }
  }
}

resource "restapi_object" "realtime_turn_key" {
  count                     = local.recording_enabled
  provider                  = restapi.cloudflare
  path                      = "/calls/turn_keys"
  data                      = jsonencode({ name = "sparkcast-recording-${var.environment}" })
  ignore_all_server_changes = true

  lifecycle {
    precondition {
      condition     = var.cloudflare_api_token != ""
      error_message = "TF_VAR_cloudflare_api_token is required to manage the Realtime apps."
    }
  }
}

# 以前の cloudflare provider のリソース（dev で一度作って state から外したもの）。何もしない
removed {
  from = cloudflare_calls_sfu_app.recording
  lifecycle {
    destroy = false
  }
}

removed {
  from = cloudflare_calls_turn_app.recording
  lifecycle {
    destroy = false
  }
}

resource "random_password" "recording_room_secret" {
  count   = local.recording_enabled
  length  = 48
  special = false
}

resource "random_password" "recording_service_secret" {
  count   = local.recording_enabled
  length  = 48
  special = false
}

# UI（Cloud Run）が env で読む秘密
resource "google_secret_manager_secret" "recording_room_secret" {
  count     = local.recording_enabled
  project   = var.project_id
  secret_id = "sparkcast-recording-room-secret"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "recording_room_secret" {
  count       = local.recording_enabled
  secret      = google_secret_manager_secret.recording_room_secret[0].id
  secret_data = random_password.recording_room_secret[0].result
}

resource "google_secret_manager_secret" "recording_service_secret" {
  count     = local.recording_enabled
  project   = var.project_id
  secret_id = "sparkcast-recording-service-secret"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "recording_service_secret" {
  count       = local.recording_enabled
  secret      = google_secret_manager_secret.recording_service_secret[0].id
  secret_data = random_password.recording_service_secret[0].result
}

# Worker（wrangler secret bulk）にそのまま渡す JSON。値はすべて Terraform が持つ
# （ROOM_SECRET / SERVICE_SECRET は UI 用の secret と同じ値、Realtime の値は上の作成時の応答から）。
resource "google_secret_manager_secret" "recording_worker_secrets" {
  count     = local.recording_enabled
  project   = var.project_id
  secret_id = "sparkcast-recording-worker-secrets"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "recording_worker_secrets" {
  count  = local.recording_enabled
  secret = google_secret_manager_secret.recording_worker_secrets[0].id
  secret_data = sensitive(jsonencode({
    ROOM_SECRET    = random_password.recording_room_secret[0].result
    SERVICE_SECRET = random_password.recording_service_secret[0].result
    SFU_APP_ID     = restapi_object.realtime_sfu_app[0].id
    SFU_APP_TOKEN  = jsondecode(restapi_object.realtime_sfu_app[0].create_response).result.secret
    TURN_KEY_ID    = restapi_object.realtime_turn_key[0].id
    TURN_KEY_TOKEN = jsondecode(restapi_object.realtime_turn_key[0].create_response).result.secret
  }))
}

resource "google_secret_manager_secret_iam_member" "app_recording_secrets" {
  for_each = var.enable_recording ? {
    room    = google_secret_manager_secret.recording_room_secret[0].secret_id
    service = google_secret_manager_secret.recording_service_secret[0].secret_id
  } : {}

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

# CD の realtime ジョブ（github-actions-deployer）が Worker の secret を投入するために読む
resource "google_secret_manager_secret_iam_member" "deployer_recording_worker_secrets" {
  count     = local.recording_enabled
  project   = var.project_id
  secret_id = google_secret_manager_secret.recording_worker_secrets[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:github-actions-deployer@${var.project_id}.iam.gserviceaccount.com"
}

# mixer Job: R2 の録音をミックスして GCS 入力バケットの source/ に FLAC を置く。
# 起動は UI（収録の確定時）から Jobs API の run（env の上書き付き）で行う。
resource "google_cloud_run_v2_job" "recording_mixer" {
  count               = local.recording_enabled
  name                = local.recording_mixer_job_name
  location            = var.region
  deletion_protection = false

  template {
    template {
      service_account = local.default_compute_service_account
      timeout         = "3600s"
      max_retries     = 1

      containers {
        image   = local.app_image_uri
        command = ["python", "-m", "mixer_main"]

        resources {
          limits = {
            memory = "8Gi"
            cpu    = "2"
          }
        }

        env {
          name  = "GCS_BUCKET"
          value = google_storage_bucket.input.name
        }
        # 話者別トラックを文字起こし用に置く（transcription.tf）
        env {
          name  = "WORK_BUCKET"
          value = google_storage_bucket.work.name
        }
        env {
          name  = "RECORDINGS_BUCKET"
          value = cloudflare_r2_bucket.recordings[0].name
        }
        env {
          name  = "CLOUDFLARE_ACCOUNT_ID"
          value = var.cloudflare_account_id
        }
        env {
          name = "CLOUDFLARE_ACCESS_KEY_ID"
          value_source {
            secret_key_ref {
              secret  = var.cloudflare_access_key_id_secret_name
              version = "latest"
            }
          }
        }
        env {
          name = "CLOUDFLARE_SECRET_ACCESS_KEY"
          value_source {
            secret_key_ref {
              secret  = var.cloudflare_secret_access_key_secret_name
              version = "latest"
            }
          }
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = var.database_url_secret_name
              version = "latest"
            }
          }
        }
        env {
          name = "DISCORD_WEBHOOK_ERROR_URL"
          value_source {
            secret_key_ref {
              secret  = var.discord_webhook_error_secret_name
              version = "latest"
            }
          }
        }
        # 起動ごとに UI が上書きする（RECORDING_SESSION_ID / PODCAST_ID / EPISODE_ID / OUTPUT_OBJECT_PATH）
      }
    }
  }

  depends_on = [
    module.cloud_run_job,
    google_project_service.required,
  ]
}

# UI のアプリ SA は、この Job だけを env の上書き付きで起動できる
resource "google_cloud_run_v2_job_iam_member" "app_run_recording_mixer" {
  count    = local.recording_enabled
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.recording_mixer[0].name
  role     = "roles/run.jobsExecutorWithOverrides"
  member   = "serviceAccount:${google_service_account.app.email}"
}
