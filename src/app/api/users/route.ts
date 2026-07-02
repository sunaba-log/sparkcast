import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getSessionUser } from "@/server/auth";
import { getDbPool } from "@/server/db";

const requestSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
});

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const { displayName } = requestSchema.parse(await request.json());
    await (await getDbPool()).query(
      `INSERT INTO users (user_id, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (email)
       DO UPDATE SET display_name = EXCLUDED.display_name`,
      [user.uid, user.email, displayName],
    );
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "入力内容が不正です" }, { status: 400 });
    }
    console.error("Failed to register user", error);
    return NextResponse.json(
      { error: "ユーザ登録に失敗しました" },
      { status: 500 },
    );
  }
}
