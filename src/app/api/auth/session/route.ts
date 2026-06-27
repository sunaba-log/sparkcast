import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { SESSION_COOKIE_NAME } from "@/server/auth";
import { getDbPool } from "@/server/db";
import {
  getAllowedDevEmails,
  getDefaultPodcastId,
} from "@/server/env";
import { getAdminAuth } from "@/server/firebase-admin";

const requestSchema = z.object({
  idToken: z.string().min(1),
});
const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const { idToken } = requestSchema.parse(await request.json());
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const email = decoded.email?.toLowerCase();
    if (!email || !getAllowedDevEmails().includes(email)) {
      return NextResponse.json(
        { error: "このdev環境へのアクセスは許可されていません" },
        { status: 403 },
      );
    }

    const podcastId = getDefaultPodcastId();
    const client = await (await getDbPool()).connect();
    try {
      await client.query("BEGIN");
      const existingUser = await client.query<{ user_id: string }>(
        "SELECT user_id FROM users WHERE email = $1",
        [email],
      );
      const appUserId = existingUser.rows[0]?.user_id ?? decoded.uid;
      if (existingUser.rowCount) {
        await client.query(
          "UPDATE users SET display_name = $2 WHERE user_id = $1",
          [appUserId, decoded.name ?? null],
        );
      } else {
        await client.query(
          `INSERT INTO users (user_id, email, display_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id)
           DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name`,
          [appUserId, email, decoded.name ?? null],
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

    const sessionCookie = await getAdminAuth().createSessionCookie(idToken, {
      expiresIn: SESSION_DURATION_MS,
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_MS / 1000,
    });
    return response;
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "入力内容が不正です" }, { status: 400 });
    }
    console.error("Failed to create auth session", {
      name: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: "ログインに失敗しました" }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
