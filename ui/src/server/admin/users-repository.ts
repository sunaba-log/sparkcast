import "server-only";

import type { Pool } from "pg";

export interface PendingUser {
  uid: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

export async function listPendingUsers(pool: Pool): Promise<PendingUser[]> {
  const result = await pool.query<{
    user_id: string;
    email: string;
    display_name: string | null;
    created_at: string;
  }>(
    `SELECT user_id, email, display_name, created_at
     FROM users
     WHERE approval_status = 'pending_approval'
     ORDER BY created_at ASC`,
  );

  return result.rows.map((row) => ({
    uid: row.user_id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
  }));
}

export async function approveUser(pool: Pool, userId: string): Promise<void> {
  await pool.query(
    `UPDATE users SET approval_status = 'active' WHERE user_id = $1`,
    [userId],
  );
}

export async function deleteUser(pool: Pool, userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM podcast_ownerships WHERE user_id = $1",
      [userId],
    );
    await client.query("DELETE FROM users WHERE user_id = $1", [userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
