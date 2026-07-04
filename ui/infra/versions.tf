terraform {
  required_version = ">= 1.3.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    # google_project_service_identity（サービスエージェントの明示プロビジョニング）が beta のみのため
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }

  # state は共有の GCS バケットでリモート管理する。
  # bucket は環境ごとに異なるため environments/<env>/backend.conf で指定する
  # （make terraform-init ENVIRONMENT=<env>）。
  backend "gcs" {
    prefix = "podcast-ui/infra"
  }
}
