"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import type { PendingUser } from "@/server/admin/users-repository";

export function AdminUsersPanel({ users }: { users: PendingUser[] }) {
  const router = useRouter();
  const [approving, setApproving] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function approveUser(uid: string) {
    try {
      setApproving(uid);
      setError("");
      const response = await fetch(`/api/admin/users/${uid}/approve`, {
        method: "POST",
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "承認に失敗しました");
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "承認に失敗しました");
      setApproving(null);
    }
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center text-xs text-gray-500 gap-2">
        <span>ホーム</span>
        <span>&gt;</span>
        <span className="font-medium text-gray-800">ユーザー管理</span>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="rounded-xs border border-brand/30 p-6 space-y-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Check className="w-5 h-5 text-brand" />
            ユーザー管理
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            登録待ちユーザーを承認すると、AI チャット機能とエピソードアップロードが利用できるようになります。
          </p>
        </div>

        {users.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500">承認待ちユーザーはいません</p>
          </div>
        ) : (
          <ul className="border-t border-gray-100 pt-4 space-y-2">
            {users.map((user) => (
              <li
                key={user.uid}
                className="rounded-xs border border-brand/20 p-4 flex items-center justify-between"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-900 truncate">
                      {user.displayName || user.email}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {user.email}
                  </p>
                  <p className="mt-0.5 text-[10px] text-gray-400">
                    登録日時: {new Date(user.createdAt).toLocaleString("ja-JP")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => approveUser(user.uid)}
                  disabled={approving !== null}
                  className="shrink-0 px-4 py-2 ml-4 text-xs font-medium bg-brand text-white rounded-xs hover:bg-brand-hover disabled:opacity-50"
                >
                  {approving === user.uid ? "承認中..." : "承認"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
