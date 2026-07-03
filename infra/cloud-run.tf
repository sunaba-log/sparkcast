# Cloud Run で動く podcast-ui 本体（dev 環境）と、そのデプロイ基盤。
# イメージのビルド・デプロイは GitHub Actions（.github/workflows/）が行い、
# ここではサービス定義・レジストリ・CI 用の認証（WIF）を管理する。
resource "google_project_service" "run" {
  project            = var.project_id
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifactregistry" {
  project            = var.project_id
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "iamcredentials" {
  project            = var.project_id
  service            = "iamcredentials.googleapis.com"
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "podcast_ui" {
  project       = var.project_id
  location      = var.region
  repository_id = "podcast-ui"
  format        = "DOCKER"
  description   = "podcast-ui のアプリイメージ"

  depends_on = [google_project_service.artifactregistry]
}

resource "google_cloud_run_v2_service" "podcast_ui" {
  project  = var.project_id
  location = var.region
  name     = "podcast-ui-dev"
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.app.email

    scaling {
      min_instance_count = 0
      max_instance_count = 4
    }

    containers {
      # 初回 apply 用のプレースホルダ。実イメージは GitHub Actions がデプロイする。
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      ports {
        container_port = 8080
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "CLOUD_SQL_INSTANCE_CONNECTION_NAME"
        value = "sunabalog-dev:asia-northeast1:podcast"
      }
      env {
        name  = "DB_NAME"
        value = "podcast"
      }
      env {
        name  = "DB_USER"
        value = "podcast"
      }
      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.app["db-password"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "GCS_UPLOAD_BUCKET"
        value = var.upload_bucket
      }
      env {
        name  = "GCS_SIGNED_URL_TTL_SECONDS"
        value = "900"
      }
      env {
        name = "CRON_SECRET"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.app["cron-secret"].secret_id
            version = "latest"
          }
        }
      }
    }
  }

  # デプロイ（イメージ更新・タグ付きリビジョン）は GitHub Actions が行うため無視する
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].labels,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_iam_member.app_secrets,
  ]
}

# 管理画面はアプリ側の Firebase Auth で保護するため、HTTP は公開する。
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = google_cloud_run_v2_service.podcast_ui.location
  name     = google_cloud_run_v2_service.podcast_ui.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "cloud_run_uri" {
  description = "Cloud Run サービスの URL"
  value       = google_cloud_run_v2_service.podcast_ui.uri
}
