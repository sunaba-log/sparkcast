import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/server/auth";
import { getDbPool } from "@/server/db";
import {
  getAllowedDevEmails,
  getDefaultPodcastId,
  isLocalMockAuthEnabled,
} from "@/server/env";

const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000;

export async function POST() {
  if (process.env.NODE_ENV === "production" || !isLocalMockAuthEnabled()) {
    return NextResponse.json(
      { error: "ローカル開発用モック認証は無効化されています" },
      { status: 403 },
    );
  }

  try {
    const email = getAllowedDevEmails()[0] ?? "admin@sunabalog.com";
    const displayName = "Dev Mock User";
    const podcastId = getDefaultPodcastId();
    const mockUid = "dev_mock_" + email.replace(/[^a-zA-Z0-9]/g, "_");

    const client = await (await getDbPool()).connect();
    try {
      await client.query("BEGIN");
      const existingUser = await client.query<{ user_id: string }>(
        "SELECT user_id FROM users WHERE email = $1",
        [email],
      );
      const appUserId = existingUser.rows[0]?.user_id ?? mockUid;
      if (existingUser.rowCount) {
        await client.query(
          "UPDATE users SET display_name = COALESCE(display_name, $2) WHERE user_id = $1",
          [appUserId, displayName],
        );
      } else {
        await client.query(
          `INSERT INTO users (user_id, email, display_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id)
           DO UPDATE SET email = EXCLUDED.email`,
          [appUserId, email, displayName],
        );
      }
      await client.query(
        `INSERT INTO podcast_ownerships (podcast_id, user_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (podcast_id, user_id) DO NOTHING`,
        [podcastId, appUserId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const mockSessionCookie = `mock_session:${email}`;
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, mockSessionCookie, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_MS / 1000,
    });
    return response;
  } catch (error) {
    console.error("Failed to create mock auth session", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `モックログインに失敗しました (${message})` },
      { status: 500 },
    );
  }
}
