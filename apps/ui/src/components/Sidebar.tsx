"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Radio,
  Share2,
  Lightbulb,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Podcast,
  ChevronDown,
  Check,
  Mic,
  Menu,
  X,
} from "lucide-react";
import type { PodcastSummary } from "@/types/podcast";
import { AccountMenu } from "./AccountMenu";

type MobileNavContextType = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};

const MobileNavContext = createContext<MobileNavContextType>({
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
});

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);

  // ルート遷移時に自動でドロワーを閉じる（レンダー中の状態調整）
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setIsOpen(false);
  }

  // モバイル画面からデスクトップ画面にリサイズされたら閉じる
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setIsOpen(false);
      }
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  return (
    <MobileNavContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNav() {
  return useContext(MobileNavContext);
}

export function MobileMenuButton() {
  const { open, isOpen } = useMobileNav();

  return (
    <button
      id="mobile-menu-button"
      type="button"
      onClick={open}
      aria-label="メニューを開く"
      aria-expanded={isOpen}
      aria-controls="mobile-nav-drawer"
      className="md:hidden p-1.5 sm:p-2 -ml-1 rounded-md text-brand hover:bg-brand-subtle/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <Menu className="w-5 h-5 text-brand" />
    </button>
  );
}

export function Sidebar({
  channelTitle,
  podcasts,
  selectedPodcastId,
  userDisplayName,
  userRegistered,
  userIsAdmin,
  recordingEnabled = false,
}: {
  channelTitle: string | null;
  podcasts: PodcastSummary[];
  selectedPodcastId: number | null;
  userDisplayName: string | null;
  userRegistered: boolean;
  userIsAdmin: boolean;
  recordingEnabled?: boolean;
}) {
  const pathname = usePathname();
  const { isOpen, close } = useMobileNav();

  // デスクトップ表示時の折りたたみ状態（md 以上で適用）
  const [collapsed, setCollapsed] = useState(false);
  const [desktopSwitcherOpen, setDesktopSwitcherOpen] = useState(false);
  const [mobileSwitcherOpen, setMobileSwitcherOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const prevOpenRef = useRef(isOpen);

  // ESCキー押下時にドロワーを閉じる
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        const menuButton = document.getElementById("mobile-menu-button");
        menuButton?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, close]);

  // モバイルドロワー表示中の背景スクロールを抑止
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  // ドロワー展開時に閉じるボタンへフォーカス
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      closeButtonRef.current?.focus();
    }
    prevOpenRef.current = isOpen;
  }, [isOpen]);

  const isChannelPage = pathname === "/";
  const hasChannel = channelTitle !== null;

  const navItems =
    isChannelPage || !hasChannel
      ? [{ href: "/", label: "チャンネル", icon: Podcast }]
      : [
          { href: "/episodes", label: "エピソード", icon: Radio },
          ...(recordingEnabled ? [{ href: "/record", label: "収録", icon: Mic }] : []),
          { href: "/sns", label: "SNS投稿", icon: Share2 },
          { href: "/agenda", label: "次回議題", icon: Lightbulb },
          { href: "/settings", label: "番組設定", icon: Settings },
        ];

  async function switchChannel(podcastId: number) {
    if (podcastId === selectedPodcastId) {
      setDesktopSwitcherOpen(false);
      setMobileSwitcherOpen(false);
      close();
      return;
    }
    try {
      setSwitching(true);
      const response = await fetch("/api/podcasts/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ podcastId }),
      });
      if (!response.ok) {
        setSwitching(false);
        return;
      }
      // 全画面を選択中チャンネルの内容へ確実に切り替えるため完全リロードする
      window.location.assign("/episodes");
    } catch {
      setSwitching(false);
    }
  }

  return (
    <>
      {/* デスクトップ用サイドバー (md 以上で表示、md 未満は非表示) */}
      <aside
        className={`bg-app-bg border-r border-brand/20 transition-all duration-300 hidden md:flex flex-col shrink-0 ${
          collapsed ? "w-16" : "w-56"
        }`}
      >
        <div className="h-14 px-4 flex items-center justify-between border-b border-brand/20 relative">
          {!collapsed && !isChannelPage && (
            <button
              type="button"
              onClick={() => setDesktopSwitcherOpen((open) => !open)}
              title="チャンネルを切り替え"
              className="flex items-center gap-1 min-w-0 font-bold text-gray-900 text-sm tracking-tight hover:text-brand transition-colors"
            >
              <span className="truncate">{channelTitle ?? "チャンネル未選択"}</span>
              <ChevronDown className="w-4 h-4 shrink-0 text-brand" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            className="p-1.5 rounded-md text-brand hover:bg-brand-subtle/50 transition-colors ml-auto"
            title={collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}
          >
            {collapsed ? (
              <ChevronsRight className="w-4 h-4 text-brand" />
            ) : (
              <ChevronsLeft className="w-4 h-4 text-brand" />
            )}
          </button>

          {!collapsed && desktopSwitcherOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setDesktopSwitcherOpen(false)}
              />
              <div className="absolute left-3 top-14 z-20 w-52 bg-app-bg border border-brand/30 rounded-xs shadow-lg py-1">
                {podcasts.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-500">
                    チャンネルがありません
                  </p>
                ) : (
                  <ul className="max-h-64 overflow-y-auto">
                    {podcasts.map((podcast) => {
                      const isSelected = podcast.id === selectedPodcastId;
                      return (
                        <li key={podcast.id}>
                          <button
                            type="button"
                            onClick={() => switchChannel(podcast.id)}
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
                  onClick={() => setDesktopSwitcherOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs text-brand border-t border-brand/20 hover:bg-brand-subtle/40"
                >
                  <Podcast className="w-3.5 h-3.5" /> チャンネル管理
                </Link>
              </div>
            </>
          )}
        </div>

        <nav className="p-3 space-y-1.5 flex-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : item.href === "/episodes"
                  ? pathname === "/episodes" || pathname.startsWith("/episodes")
                  : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xs text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? "text-brand border border-brand font-bold"
                    : "text-gray-700 hover:bg-brand-subtle/40 hover:text-gray-900"
                } ${collapsed ? "justify-center px-0" : ""}`}
                title={collapsed ? item.label : undefined}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive ? "text-brand" : "text-gray-500"
                  }`}
                />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-brand/20 shrink-0">
          <AccountMenu
            displayName={userDisplayName}
            registered={userRegistered}
            isAdmin={userIsAdmin}
            collapsed={collapsed}
          />
        </div>
      </aside>

      {/* モバイル用オーバーレイ & ドロワー (md 未満で有効) */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-xs transition-opacity duration-300 md:hidden ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={close}
        aria-hidden="true"
      />

      <div
        id="mobile-nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="ナビゲーションメニュー"
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-app-bg border-r border-brand/20 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out md:hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] ${
          isOpen ? "translate-x-0" : "-translate-x-full pointer-events-none"
        }`}
      >
        {/* ドロワーヘッダー: ロゴと閉じるボタン */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-brand/20 shrink-0">
          <Link
            href="/"
            onClick={close}
            className="flex items-center hover:opacity-90 transition-opacity"
          >
            <Image
              src="/sparkcast_logo.svg"
              alt="SparkCast"
              width={140}
              height={28}
              priority
              unoptimized
              className="h-6 w-auto"
            />
          </Link>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={close}
            aria-label="メニューを閉じる"
            className="p-1.5 rounded-md text-gray-500 hover:text-gray-900 hover:bg-brand-subtle/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* チャンネル切り替えセクション */}
        {!isChannelPage && (
          <div className="p-3 border-b border-brand/20 shrink-0">
            <div className="relative">
              <button
                type="button"
                onClick={() => setMobileSwitcherOpen((prev) => !prev)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xs border border-brand/30 bg-app-bg text-left hover:border-brand transition-colors text-sm font-bold text-gray-900"
              >
                <span className="truncate">{channelTitle ?? "チャンネル未選択"}</span>
                <ChevronDown
                  className={`w-4 h-4 text-brand shrink-0 transition-transform duration-200 ${
                    mobileSwitcherOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {mobileSwitcherOpen && (
                <div className="mt-1 border border-brand/30 rounded-xs bg-app-bg shadow-md overflow-hidden">
                  {podcasts.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-500">
                      チャンネルがありません
                    </p>
                  ) : (
                    <ul className="max-h-48 overflow-y-auto divide-y divide-brand/10">
                      {podcasts.map((podcast) => {
                        const isSelected = podcast.id === selectedPodcastId;
                        return (
                          <li key={podcast.id}>
                            <button
                              type="button"
                              onClick={() => {
                                close();
                                switchChannel(podcast.id);
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
                    onClick={() => {
                      setMobileSwitcherOpen(false);
                      close();
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-xs text-brand border-t border-brand/20 hover:bg-brand-subtle/40 font-medium"
                  >
                    <Podcast className="w-3.5 h-3.5" /> チャンネル管理
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ナビゲーションメニュー */}
        <nav className="p-3 space-y-1.5 flex-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : item.href === "/episodes"
                  ? pathname === "/episodes" || pathname.startsWith("/episodes")
                  : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xs text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? "text-brand border border-brand font-bold bg-brand-light/30"
                    : "text-gray-700 hover:bg-brand-subtle/40 hover:text-gray-900"
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive ? "text-brand" : "text-gray-500"
                  }`}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* アカウントメニュー */}
        <div className="p-3 border-t border-brand/20 shrink-0">
          <AccountMenu
            displayName={userDisplayName}
            registered={userRegistered}
            isAdmin={userIsAdmin}
            collapsed={false}
          />
        </div>
      </div>
    </>
  );
}
