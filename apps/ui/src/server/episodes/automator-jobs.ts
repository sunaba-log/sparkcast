import "server-only";

import { getGoogleAccessToken } from "@/server/recording/jobs";
import { getAutomatorJobName } from "@/server/env";

export type AutomatorJobTriggerInput = {
  action?: string;
  podcastId?: number;
  gcsTriggerObjectName?: string;
  resumeFromAudit?: boolean;
  publishOriginal?: boolean;
};

export function buildAutomatorJobOverrides(input: AutomatorJobTriggerInput) {
  const env: Array<{ name: string; value: string }> = [];

  if (input.action) {
    env.push({ name: "ACTION", value: input.action });
  }
  if (input.podcastId !== undefined) {
    env.push({ name: "PODCAST_ID", value: String(input.podcastId) });
  }
  if (input.gcsTriggerObjectName) {
    env.push({ name: "GCS_TRIGGER_OBJECT_NAME", value: input.gcsTriggerObjectName });
  }
  if (input.resumeFromAudit) {
    env.push({ name: "RESUME_FROM_AUDIT", value: "true" });
  }
  if (input.publishOriginal) {
    env.push({ name: "PUBLISH_ORIGINAL", value: "true" });
  }

  return {
    overrides: {
      containerOverrides: [
        {
          env,
        },
      ],
    },
  };
}

export async function runAutomatorJob(
  input: AutomatorJobTriggerInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ executionName: string | null; skipped?: boolean }> {
  const jobName = getAutomatorJobName();
  if (!jobName) {
    console.warn("AUTOMATOR_JOB_NAME is not set; skipping Cloud Run Job execution");
    return { executionName: null, skipped: true };
  }

  try {
    const token = await getGoogleAccessToken(fetchImpl);
    const response = await fetchImpl(`https://run.googleapis.com/v2/${jobName}:run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildAutomatorJobOverrides(input)),
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(`Failed to run automator job: ${response.status} ${text.slice(0, 300)}`);
      throw new Error(`Failed to run automator job: ${response.status}`);
    }

    const operation = (await response.json()) as { metadata?: { name?: string } };
    return { executionName: operation.metadata?.name ?? null };
  } catch (error) {
    console.error("Error triggering automator Cloud Run job:", error);
    throw error;
  }
}
