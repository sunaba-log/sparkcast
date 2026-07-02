"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Radio, Share2, Lightbulb, Settings, ChevronsLeft, ChevronsRight, Podcast } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "エピソード", icon: Radio },
  { href: "/sns", label: "SNS投稿", icon: Share2 },
  { href: "/agenda", label: "次回議題", icon: Lightbulb },
  { href: "/channels", label: "チャンネル", icon: Podcast },
  { href: "/settings", label: "番組設定", icon: Settings },
];

export function Sidebar({ channelTitle }: { channelTitle: string | null }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`bg-app-bg border-r border-brand/20 transition-all duration-300 flex flex-col shrink-0 ${collapsed ? "w-16" : "w-56"
        }`}
    >
      <div className="h-14 px-4 flex items-center justify-between border-b border-brand/20">
        {!collapsed && (
          <Link
            href="/channels"
            title="チャンネルを切り替え"
            className="font-bold text-gray-900 text-base tracking-tight truncate hover:text-brand transition-colors"
          >
            {channelTitle ?? "チャンネル未選択"}
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md text-brand hover:bg-brand-subtle/50 transition-colors ml-auto"
          title={collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}
        >
          {collapsed ? (
            <ChevronsRight className="w-4 h-4 text-brand" />
          ) : (
            <ChevronsLeft className="w-4 h-4 text-brand" />
          )}
        </button>
      </div>

      <nav className="p-3 space-y-1.5 flex-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? pathname === "/" || pathname.startsWith("/episodes")
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xs text-sm font-medium transition-all duration-150 ${isActive
                ? "text-brand border border-brand font-bold"
                : "text-gray-700 hover:bg-brand-subtle/40 hover:text-gray-900"
                } ${collapsed ? "justify-center px-0" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <Icon
                className={`w-4 h-4 shrink-0 ${isActive ? "text-brand" : "text-gray-500"
                  }`}
              />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
