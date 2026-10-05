terraform {
  required_version = ">= 1.14.3"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.14"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.14"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
    # Cloudflare provider が扱えない API（Realtime の SFU / TURN アプリ）を Terraform で管理する（recording.tf）
    restapi = {
      source  = "Mastercard/restapi"
      version = "~> 3.0"
    }
  }

  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region

  default_labels = {
    org         = var.org
    environment = var.environment
    system      = var.system
  }
}

provider "google-beta" {
  project = var.project_id
  region  = var.region

  default_labels = {
    org         = var.org
    environment = var.environment
    system      = var.system
  }
}

provider "cloudflare" {}

# Cloudflare の API を直接呼ぶ（recording.tf の Realtime アプリ）。応答は { result: { uid, ... } } の形
provider "restapi" {
  alias                = "cloudflare"
  uri                  = "https://api.cloudflare.com/client/v4/accounts/${var.cloudflare_account_id}"
  write_returns_object = true
  id_attribute         = "result/uid"
  headers = {
    Authorization  = "Bearer ${var.cloudflare_api_token}"
    "Content-Type" = "application/json"
  }
}

# Billing Budget API の呼び出しは quota project に対して検査されるため、
# API を有効化した自プロジェクトを明示的に quota project として使うエイリアス。
# budget.tf の google_billing_budget が参照する。
provider "google" {
  alias                 = "billing"
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id

  default_labels = {
    org         = var.org
    environment = var.environment
    system      = var.system
  }
}
