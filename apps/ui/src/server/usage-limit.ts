import "server-only";

import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "@/server/auth";
import {
  getPendingChatLimit,
  getPendingEpisodeUploadLimit,
  getPendingRecordingSessionLimit,
  getRateLimitHourly,
  getRateLimitDaily,
} from "@/server/env";

export type UsageAction = "chat" | "episode_upload" | "recording_session";

export interface UsageCheckResult {
  allowed: boolean;
  reason?: string;
}

function getPendingLimit(action: UsageAction): number {
  switch (action) {
    case "chat":
      return getPendingChatLimit();
    case "episode_upload":
      return getPendingEpisodeUploadLimit();
    case "recording_session":
      return getPendingRecordingSessionLimit();
  }
}

type Queryable = Pick<Pool, "query"> | PoolClient;

export async function checkUsageAllowed(
  pool: Queryable,
  user: SessionUser,
  action: UsageAction,
): Promise<UsageCheckResult> {
  if (user.approvalStatus === "pending_approval") {
    const limit = getPendingLimit(action);
    const result = await pool.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM api_usage_logs
       WHERE user_id = $1 AND endpoint = $2`,
      [user.uid, action],
    );
    const count = parseInt(result.rows[0]?.count?.toString() ?? "0", 10);
    if (count >= limit) {
      return {
        allowed: false,
        reason: "お試し枠の上限に達しました。管理者の承認をお待ちください",
      };
    }
  } else if (action === "chat") {
    const hourlyLimit = getRateLimitHourly();
    const dailyLimit = getRateLimitDaily();

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [hourlyResult, dailyResult] = await Promise.all([
      pool.query<{ count: number }>(
        `SELECT COUNT(*) as count FROM api_usage_logs
         WHERE user_id = $1 AND endpoint = $2 AND called_at > $3`,
        [user.uid, action, oneHourAgo],
      ),
      pool.query<{ count: number }>(
        `SELECT COUNT(*) as count FROM api_usage_logs
         WHERE user_id = $1 AND endpoint = $2 AND called_at > $3`,
        [user.uid, action, oneDayAgo],
      ),
    ]);

    const hourlyCount = parseInt(hourlyResult.rows[0]?.count?.toString() ?? "0", 10);
    const dailyCount = parseInt(dailyResult.rows[0]?.count?.toString() ?? "0", 10);

    if (hourlyCount >= hourlyLimit) {
      return {
        allowed: false,
        reason: "利用回数の上限に達しました。しばらくしてから再度お試しください",
      };
    }

    if (dailyCount >= dailyLimit) {
      return {
        allowed: false,
        reason: "1日の利用回数の上限に達しました。明日以降にお試しください",
      };
    }
  }

  return { allowed: true };
}

export async function recordUsage(
  pool: Queryable,
  userId: string,
  action: UsageAction,
): Promise<void> {
  await pool.query(
    `INSERT INTO api_usage_logs (user_id, endpoint, called_at)
     VALUES ($1, $2, now())`,
    [userId, action],
  );
}

/**
 * 利用可否の確認と記録を、利用者・操作ごとのロックの中で一体に行う。
 * 確認と記録が別だと、同時実行で残り枠を複数のリクエストが使えてしまう。
 */
export async function reserveUsage(
  pool: Pool,
  user: SessionUser,
  action: UsageAction,
): Promise<UsageCheckResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `usage:${user.uid}:${action}`,
    ]);
    const result = await checkUsageAllowed(client, user, action);
    if (result.allowed) await recordUsage(client, user.uid, action);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
