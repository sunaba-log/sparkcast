provider "google" {
  project = var.project_id
  region  = var.region

  # orgpolicy など一部 API は quota project の指定が必要
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project = var.project_id
  region  = var.region

  user_project_override = true
  billing_project       = var.project_id
}
