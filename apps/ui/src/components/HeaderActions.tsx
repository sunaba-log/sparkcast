"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { ChatWidget } from "@/components/ChatWidget";

export function HeaderActions() {
  const pathname = usePathname();

  // チャネル管理画面 (ルートパス "/") では表示しない
  if (pathname === "/") {
    return null;
  }

  return (
    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
      {/* 作業系（高頻度）を左に、アカウント系を右端に分けて配置する */}
      <Link
        href="/upload"
        title="新規エピソード追加"
        aria-label="新規エピソード追加"
        className="p-2 sm:px-4 sm:py-2 text-xs font-normal bg-brand text-white rounded-xs hover:bg-brand-hover transition-colors flex items-center gap-1.5 border border-brand shrink-0"
      >
        <Plus className="w-4 h-4 shrink-0" />
        <span className="hidden sm:inline">新規エピソード追加</span>
      </Link>
      <ChatWidget />
    </div>
  );
}
