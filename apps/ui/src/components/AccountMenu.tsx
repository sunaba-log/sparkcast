"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import {
  Check,
  ChevronDown,
  CircleUserRound,
  LogOut,
  Podcast,
  Settings,
  Shield,
} from "lucide-react";
import { getFirebaseAuth } from "@/lib/firebase-client";
import type { PodcastSummary } from "@/types/podcast";

export function AccountMenu({
  displayName,
  registered,
  isAdmin,
  channelTitle,
  podcasts,
  selectedPodcastId,
  switching = false,
  onSelectChannel,
  collapsed = false,
}: {
  displayName: string | null;
  registered: boolean;
  isAdmin: boolean;
  channelTitle: string | null;
  podcasts: PodcastSummary[];
  selectedPodcastId: number | null;
  switching?: boolean;
  onSelectChannel: (podcastId: number) => void;
  // null = サイドバーが自動（狭い画面だけ折りたたみ）
  collapsed?: boolean | null;
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
    <div className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="アカウントメニュー"
        className={`flex items-center text-gray-700 hover:text-brand hover:bg-brand-subtle/40 rounded-xs transition-colors w-full ${
          collapsed === null
            ? "justify-center px-0 py-2.5 md:justify-start md:gap-3 md:px-3 text-sm font-medium"
            : collapsed
              ? "justify-center px-0 py-2.5"
              : "gap-3 px-3 py-2.5 text-sm font-medium"
        }`}
      >
        <CircleUserRound className="w-4 h-4 text-brand shrink-0" />
        {collapsed !== true && (
          <span className={collapsed === null ? "hidden md:contents" : "contents"}>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate">{displayName ?? "アカウント"}</span>
              <span className="block truncate text-xs font-normal text-gray-500">
                {channelTitle ?? "チャンネル未選択"}
              </span>
            </span>
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-gray-500" />
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 bottom-full mb-1 z-20 w-56 bg-app-bg border border-brand/30 rounded-xs shadow-lg overflow-hidden">
            <div className="py-1 border-b border-brand/20">
              <p className="px-3 py-1 text-xs font-medium text-gray-500">チャンネル</p>
              {podcasts.length === 0 ? (
                <p className="px-3 py-2 text-xs text-gray-500">チャンネルがありません</p>
              ) : (
                <ul className="max-h-48 overflow-y-auto">
                  {podcasts.map((podcast) => {
                    const isSelected = podcast.id === selectedPodcastId;
                    return (
                      <li key={podcast.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            onSelectChannel(podcast.id);
                          }}
                          disabled={switching}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-brand-subtle/40 disabled:opacity-50 ${
                            isSelected ? "text-brand font-semibold" : "text-gray-700"
                          }`}
                        >
                          <Check
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isSelected ? "text-brand" : "text-transparent"
                            }`}
                          />
                          <span className="truncate">{podcast.title}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Link
                href="/"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-brand border-t border-brand/20 hover:bg-brand-subtle/40"
              >
                <Podcast className="w-3.5 h-3.5" />
                チャンネル管理
              </Link>
            </div>
            <div className="py-1">
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
          </div>
        </>
      )}
    </div>
  );
}
