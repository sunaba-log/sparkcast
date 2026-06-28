# 議事録 RAG の横断検索（findNearest / KNN）に使うベクトルインデックス。
# podcasts/{podcastId}/minutes_index コレクションの embedding フィールドを対象とする。
resource "google_firestore_index" "minutes_index" {
  project     = var.project_id
  database    = "(default)"
  collection  = "minutes_index"
  query_scope = "COLLECTION"

  fields {
    field_path = "__name__"
    order      = "ASCENDING"
  }

  fields {
    field_path = "embedding"
    vector_config {
      dimension = 768
      flat {}
    }
  }
}
