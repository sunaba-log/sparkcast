"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { ChevronDown, CircleUserRound, LogOut, Settings, Shield } from "lucide-react";
import { getFirebaseAuth } from "@/lib/firebase-client";

export function AccountMenu({
  displayName,
  registered,
  isAdmin,
}: {
  displayName: string | null;
  registered: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

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
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="アカウントメニュー"
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-700 hover:text-brand rounded-xs hover:bg-brand-subtle/40 transition-colors"
      >
        <CircleUserRound className="w-4 h-4 text-brand" />
        <span className="max-w-[10rem] truncate">
          {displayName ?? "アカウント"}
        </span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-app-bg border border-brand/30 rounded-xs shadow-lg py-1">
            {registered && (
              <Link
                href="/account"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-brand-subtle/40"
              >
                <Settings className="w-3.5 h-3.5 text-gray-500" />
                アカウント設定
              </Link>
            )}
            {isAdmin && (
              <Link
                href="/admin"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-brand-subtle/40"
              >
                <Shield className="w-3.5 h-3.5 text-gray-500" />
                ユーザー管理
              </Link>
            )}
            <button
              type="button"
              onClick={logout}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 text-left border-t border-brand/20 hover:bg-brand-subtle/40"
            >
              <LogOut className="w-3.5 h-3.5 text-gray-500" />
              ログアウト
            </button>
          </div>
        </>
      )}
    </div>
  );
}
