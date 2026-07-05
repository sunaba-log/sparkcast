import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getDbPool } from "@/server/db";
import { listPendingUsers } from "@/server/admin/users-repository";
import { AdminUsersPanel } from "@/components/AdminUsersPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  // 一覧は管理者にだけ渡す（権限なしユーザーには DB を引かず案内のみ表示）
  const pendingUsers = user.isAdmin
    ? await listPendingUsers(await getDbPool())
    : [];

  return <AdminUsersPanel users={pendingUsers} isAdmin={user.isAdmin} />;
}
