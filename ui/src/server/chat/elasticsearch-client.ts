import "server-only";

import { Client } from "@elastic/elasticsearch";
import { getElasticsearchApiKey, getElasticsearchUrl } from "@/server/env";

let client: Client | null = null;

/** Elasticsearch バックエンドが設定されているか（未設定なら Firestore を使う）。 */
export function isElasticsearchEnabled(): boolean {
  return Boolean(getElasticsearchUrl());
}

export function getElasticsearchClient(): Client {
  const node = getElasticsearchUrl();
  if (!node) {
    throw new Error("ELASTICSEARCH_URL is required");
  }
  if (!client) {
    const apiKey = getElasticsearchApiKey();
    client = new Client({
      node,
      ...(apiKey ? { auth: { apiKey } } : {}),
    });
  }
  return client;
}
