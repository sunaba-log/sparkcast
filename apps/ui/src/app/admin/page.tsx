import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getDbPool } from "@/server/db";
import { listUsers } from "@/server/admin/users-repository";
import { listPreRegisteredEmails } from "@/server/admin/pre-registered-emails-repository";
import { isAdminUser, isRecordingEnabled } from "@/server/env";
import { isLocalUiDemoEnabled } from "@/server/env";
import { AdminUsersPanel } from "@/components/AdminUsersPanel";
import { AdminPreRegisteredEmailsPanel } from "@/components/AdminPreRegisteredEmailsPanel";
import { UI_DEMO_PRE_REGISTERED_EMAILS, UI_DEMO_USERS } from "@/server/ui-demo";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  // 一覧は管理者にだけ渡す(権限なしユーザーには DB を引かず案内のみ表示)
  const users = isLocalUiDemoEnabled()
    ? UI_DEMO_USERS
    : user.isAdmin
    ? (await listUsers(await getDbPool())).map((row) => ({
        ...row,
        isAdmin: isAdminUser(row.email),
      }))
    : [];
  const preRegisteredEmails = isLocalUiDemoEnabled()
    ? UI_DEMO_PRE_REGISTERED_EMAILS
    : user.isAdmin
    ? await listPreRegisteredEmails(await getDbPool())
    : [];

  return (
    <div className="space-y-8">
      <AdminUsersPanel
        users={users}
        isAdmin={user.isAdmin}
        recordingEnabled={isRecordingEnabled()}
      />
      {user.isAdmin && (
        <AdminPreRegisteredEmailsPanel emails={preRegisteredEmails} />
      )}
    </div>
  );
}
