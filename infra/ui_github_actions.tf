# GitHub Actions のデプロイ認証は dev-platform に集約した OIDC(WIF) 基盤を使う。
# WIF プール github-actions / プロバイダ github-oidc と、org 共有デプロイ SA
# github-actions-deployer は dev-platform/infra が管理する（本リポジトリでは定義しない）。
#
# ここでは、共有 SA が podcast-ui のランタイム SA (google_service_account.app) として
# Cloud Run をデプロイできるよう act-as 権限だけを付与する。
# DB パスワード読み取り・Artifact Registry・Firebase Auth 等は共有 SA が保有する
# 広い権限（editor / secretmanager.admin / firebaseauth.admin 等）でカバーされる。

resource "google_service_account_iam_member" "shared_deployer_act_as_app" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:github-actions-deployer@${var.project_id}.iam.gserviceaccount.com"
}
