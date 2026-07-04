# Cloud Run で動く podcast-ui 本体と、そのデプロイ基盤。
# イメージのビルド・デプロイは GitHub Actions（.github/workflows/）が行い、
# ここではサービス定義・レジストリを管理する。API 有効化は
# google_project_service.required（locals.required_services）に集約している。

resource "google_artifact_registry_repository" "podcast_ui" {
  project       = var.project_id
  location      = var.region
  repository_id = "podcast-ui"
  format        = "DOCKER"
  description   = "podcast-ui のアプリイメージ"

  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service" "podcast_ui" {
  project  = var.project_id
  location = var.region
  name     = "podcast-ui-${var.environment}"
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
        value = google_sql_database_instance.podcast.connection_name
      }
      env {
        name  = "DB_NAME"
        value = google_sql_database.podcast.name
      }
      env {
        name  = "DB_USER"
        value = google_sql_user.podcast.name
      }
      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_password.secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "GCS_UPLOAD_BUCKET"
        value = google_storage_bucket.input.name
      }
      env {
        name  = "GCS_SIGNED_URL_TTL_SECONDS"
        value = "900"
      }
      env {
        name = "CRON_SECRET"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.cron_secret.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  # デプロイ（イメージ更新・リビジョン名・タグ付きプレビュー・トラフィック）は
  # GitHub Actions が行うため、terraform は初期作成のみ担い以降は無視する。
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].revision,
      template[0].labels,
      traffic,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_iam_member.app_secrets,
  ]
}

# 管理画面はアプリ側の Firebase Auth で保護するため、HTTP は公開する。
resource "google_cloud_run_v2_service_iam_member" "public" {
  project = var.project_id
  # ドメイン制限共有の解除（下記 org policy）が先に必要
  location = google_cloud_run_v2_service.podcast_ui.location
  name     = google_cloud_run_v2_service.podcast_ui.name
  role     = "roles/run.invoker"
  member   = "allUsers"

  depends_on = [google_org_policy_policy.allowed_policy_member_domains]
}

output "cloud_run_uri" {
  description = "Cloud Run サービスの URL"
  value       = google_cloud_run_v2_service.podcast_ui.uri
}

# 組織のドメイン制限共有ポリシーの下では allUsers への権限付与ができないため、
# この プロジェクトに限り制限を解除する（公開 Web アプリの要件）。
resource "google_org_policy_policy" "allowed_policy_member_domains" {
  name   = "projects/${var.project_id}/policies/iam.allowedPolicyMemberDomains"
  parent = "projects/${var.project_id}"

  spec {
    inherit_from_parent = false

    rules {
      allow_all = "TRUE"
    }
  }

  depends_on = [google_project_service.required]
}
