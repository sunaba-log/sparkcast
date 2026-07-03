import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { LogoutButton } from "@/components/LogoutButton";
import { ChatWidget } from "@/components/ChatWidget";
import { Sidebar } from "@/components/Sidebar";
import { getSessionUser, hasPodcastAccess } from "@/server/auth";
import { getPodcast } from "@/server/podcasts/data-repository";
import { getSelectedPodcastId } from "@/server/podcasts/selection";
import "./globals.css";

export const metadata: Metadata = {
  title: "SparkCast",
  description: "ポッドキャスト自動化管理ツール",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  let channelTitle: string | null = null;
  if (user?.registered) {
    const podcastId = await getSelectedPodcastId();
    if (podcastId && (await hasPodcastAccess(user.uid, podcastId))) {
      channelTitle = (await getPodcast(podcastId))?.title ?? null;
    }
  }
  return (
    <html lang="ja" className="h-full" suppressHydrationWarning>
      <body className="bg-app-bg text-gray-900 antialiased h-full flex flex-col font-sans">
        <header className="border-b border-brand/30 shrink-0 z-20">
          <div className="w-full px-5 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center hover:opacity-90 transition-opacity shrink-0">
              <Image
                src="/sparkcast_logo.svg"
                alt="SparkCast"
                width={168}
                height={32}
                priority
                unoptimized
                className="hidden sm:block h-6 w-auto"
              />
              <Image
                src="/sparkcast_logo_small.svg"
                alt="SparkCast"
                width={29}
                height={32}
                priority
                unoptimized
                className="block sm:hidden h-6 w-auto"
              />
            </Link>
            {user && (
              <div className="flex items-center gap-3">
                {user.registered && user.displayName && (
                  <Link
                    href="/account"
                    title="アカウント設定"
                    className="text-xs font-medium text-gray-700 hover:text-brand transition-colors max-w-[10rem] truncate"
                  >
                    {user.displayName}
                  </Link>
                )}
                <LogoutButton />
                <Link
                  href="/upload"
                  className="px-4 py-2 text-xs font-normal bg-brand text-white rounded-xs hover:bg-brand-hover transition-colors flex items-center gap-1.5 border border-brand"
                >
                  <span>+</span> 新規エピソード追加
                </Link>
                <ChatWidget />
              </div>
            )}
          </div>
        </header>
        <div className="flex-1 flex overflow-hidden min-h-0">
          {user && <Sidebar channelTitle={channelTitle} />}
          <main className="flex-1 overflow-y-auto bg-app-bg p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
