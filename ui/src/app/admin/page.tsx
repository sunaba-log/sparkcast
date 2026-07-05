import { redirect } from "next/navigation";
import { getSessionUser, requireAdmin } from "@/server/auth";
import { getDbPool } from "@/server/db";
import { listPendingUsers } from "@/server/admin/users-repository";
import { AdminUsersPanel } from "@/components/AdminUsersPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  try {
    requireAdmin(user);
  } catch {
    redirect("/");
  }

  const pool = await getDbPool();
  const pendingUsers = await listPendingUsers(pool);

  return <AdminUsersPanel users={pendingUsers} />;
}
