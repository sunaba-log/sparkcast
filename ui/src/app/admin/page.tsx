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

  const pool = await getDbPool();
  const pendingUsers = await listPendingUsers(pool);

  return <AdminUsersPanel users={pendingUsers} isAdmin={user.isAdmin} />;
}
