import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/RegisterForm";
import { getSessionUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.registered) redirect("/");
  return (
    <RegisterForm
      email={user.email}
      defaultDisplayName={user.displayName ?? ""}
    />
  );
}
