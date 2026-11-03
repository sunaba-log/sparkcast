import "server-only";

async function identityToken(url: string): Promise<string> {
  if (process.env.POLICY_MEDIA_ID_TOKEN)
    return process.env.POLICY_MEDIA_ID_TOKEN;
  const response = await fetch(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(url)}&format=full`,
    {
      headers: { "Metadata-Flavor": "Google" },
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error("音声サービスの認証に失敗しました。");
  return response.text();
}
export async function processPolicyMedia(data: Record<string, unknown>) {
  const url = process.env.POLICY_MEDIA_URL;
  if (!url) throw new Error("POLICY_MEDIA_URL が設定されていません。");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await identityToken(url)}`,
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(240_000),
  });
  const result = (await response.json()) as {
    error?: string;
    audioBase64: string;
    durationMs: number;
    transcript: string;
  };
  if (!response.ok) throw new Error(result.error ?? "音声処理に失敗しました。");
  return result;
}
