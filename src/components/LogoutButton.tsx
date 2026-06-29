"use client";

import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { getFirebaseAuth } from "@/lib/firebase-client";

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/session", { method: "DELETE" });
    try {
      await signOut(getFirebaseAuth());
    } catch {
      // Ignore errors when signed in with mock authentication
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={logout}
      className="text-sm text-gray-600 hover:text-gray-900"
    >
      ログアウト
    </button>
  );
}
