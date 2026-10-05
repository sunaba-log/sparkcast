// mixer の Cloud Run Job を env の上書き付きで起動する（#166）。
// クライアントライブラリは入れず、Cloud Run Admin API v2 を REST で呼ぶ。
// アクセストークンは Cloud Run 上ではメタデータサーバから、ローカルでは
// GOOGLE_OAUTH_ACCESS_TOKEN（`gcloud auth print-access-token`）から取る。

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

type FetchLike = typeof fetch;

export async function getGoogleAccessToken(fetchImpl: FetchLike = fetch): Promise<string> {
  const fromEnv = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  if (fromEnv) return fromEnv;
  const response = await fetchImpl(METADATA_TOKEN_URL, {
    headers: { "Metadata-Flavor": "Google" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Failed to get access token from metadata server: ${response.status}`);
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new Error("Metadata server returned no access_token");
  }
  return body.access_token;
}

export type MixerJobInput = {
  sessionId: string;
  podcastId: number;
  episodeId: number;
  objectPath: string;
};

export function buildMixerJobOverrides(input: MixerJobInput) {
  return {
    overrides: {
      containerOverrides: [
        {
          env: [
            { name: "RECORDING_SESSION_ID", value: input.sessionId },
            { name: "PODCAST_ID", value: String(input.podcastId) },
            { name: "EPISODE_ID", value: String(input.episodeId) },
            { name: "OUTPUT_OBJECT_PATH", value: input.objectPath },
          ],
        },
      ],
    },
  };
}

export async function runMixerJob(
  jobName: string,
  input: MixerJobInput,
  fetchImpl: FetchLike = fetch,
): Promise<{ executionName: string | null }> {
  const token = await getGoogleAccessToken(fetchImpl);
  const response = await fetchImpl(`https://run.googleapis.com/v2/${jobName}:run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildMixerJobOverrides(input)),
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to run mixer job: ${response.status} ${text.slice(0, 300)}`);
  }
  // 戻り値は long-running operation。metadata.name が実行（execution）名。
  const operation = (await response.json()) as { metadata?: { name?: string } };
  return { executionName: operation.metadata?.name ?? null };
}
