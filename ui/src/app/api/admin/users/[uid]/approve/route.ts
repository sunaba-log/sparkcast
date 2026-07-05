import { NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/server/auth";
import { getDbPool } from "@/server/db";
import { approveUser } from "@/server/admin/users-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ uid: string }> },
) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    requireAdmin(user);

    const { uid } = await context.params;
    const pool = await getDbPool();
    await approveUser(pool, uid);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "操作権限がありません" }, { status: 403 });
    }
    console.error("Failed to approve user", error);
    return NextResponse.json({ error: "承認に失敗しました" }, { status: 500 });
  }
}
