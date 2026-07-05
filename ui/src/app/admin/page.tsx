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

  try {
    const pool = await getDbPool();
    const pendingUsers = await listPendingUsers(pool);
    return <AdminUsersPanel users={pendingUsers} isAdmin={user.isAdmin} />;
  } catch (error) {
    console.error("Failed to load admin page", error);
    return (
      <div className="space-y-5 max-w-4xl p-6">
        <div className="rounded-xs border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">
            管理画面の読み込みに失敗しました。管理者にお問い合わせください。
          </p>
          <p className="text-xs text-red-600 mt-2">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      </div>
    );
  }
}
