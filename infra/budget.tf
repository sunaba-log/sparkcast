# 予算アラート（Billing Budget）。
# all_updates_rule を指定しない場合の既定動作として、閾値超過時に
# 請求アカウントの管理者・ユーザーへメール通知が送られる。
# 通知のみで、予算超過してもリソースは自動停止しない。
resource "google_billing_budget" "project_monthly" {
  provider = google.billing

  billing_account = var.billing_account_id
  display_name    = "${var.project_id}-monthly-budget"

  budget_filter {
    projects        = ["projects/${data.google_project.project.number}"]
    calendar_period = "MONTH"
  }

  amount {
    specified_amount {
      currency_code = "JPY"
      units         = tostring(var.budget_amount_jpy)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }

  threshold_rules {
    threshold_percent = 0.9
  }

  threshold_rules {
    threshold_percent = 1.0
  }

  depends_on = [google_project_service.required]
}
