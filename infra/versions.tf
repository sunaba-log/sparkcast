terraform {
  required_version = ">= 1.3.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # state は共有の GCS バケットでリモート管理する。
  backend "gcs" {
    bucket = "sunabalog-tfstate-dev"
    prefix = "podcast-ui/infra"
  }
}
