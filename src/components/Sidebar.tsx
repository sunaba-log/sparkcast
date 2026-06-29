"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Radio, Share2, Lightbulb, Settings, ChevronsLeft, ChevronsRight } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "エピソード", icon: Radio },
  { href: "/sns", label: "SNS投稿", icon: Share2 },
  { href: "/agenda", label: "次回議題", icon: Lightbulb },
  { href: "/settings", label: "番組設定", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`bg-[#f9f9f6] border-r border-gray-200 transition-all duration-300 flex flex-col shrink-0 ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      <div className="h-14 px-4 flex items-center justify-between border-b border-gray-200/60">
        {!collapsed && (
          <span className="font-semibold text-gray-800 text-base tracking-tight truncate">
            sunabalog
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md text-gray-500 hover:bg-gray-200/60 hover:text-gray-800 transition-colors ml-auto"
          title={collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}
        >
          {collapsed ? (
            <ChevronsRight className="w-4 h-4" />
          ) : (
            <ChevronsLeft className="w-4 h-4 text-blue-600" />
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
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                isActive
                  ? "bg-white text-blue-600 shadow-sm border border-blue-100 font-semibold"
                  : "text-gray-600 hover:bg-gray-200/50 hover:text-gray-900"
              } ${collapsed ? "justify-center px-0" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <Icon
                className={`w-4 h-4 shrink-0 ${
                  isActive ? "text-blue-600" : "text-gray-500"
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
