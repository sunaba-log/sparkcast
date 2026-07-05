import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getDbPool } from "@/server/db";
import { listUsers } from "@/server/admin/users-repository";
import { isAdminUser } from "@/server/env";
import { AdminUsersPanel } from "@/components/AdminUsersPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  // 一覧は管理者にだけ渡す(権限なしユーザーには DB を引かず案内のみ表示)
  const users = user.isAdmin
    ? (await listUsers(await getDbPool())).map((row) => ({
        ...row,
        isAdmin: isAdminUser(row.email),
      }))
    : [];

  return <AdminUsersPanel users={users} isAdmin={user.isAdmin} />;
}
