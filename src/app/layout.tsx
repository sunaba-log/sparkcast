import type { Metadata } from "next";
import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { ChatWidget } from "@/components/ChatWidget";
import { Sidebar } from "@/components/Sidebar";
import { getSessionUser } from "@/server/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Podcast Automater",
  description: "ポッドキャスト自動化管理ツール",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <html lang="ja" className="h-full">
      <body className="bg-[#f7f7f8] text-gray-900 antialiased h-full flex flex-col font-sans">
        <header className="bg-white border-b border-gray-200 shrink-0 z-20">
          <div className="w-full px-5 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-1.5 text-lg font-bold tracking-tight text-blue-700 hover:opacity-90 transition-opacity">
              <span>SparkCast</span>
              <span className="text-xs font-normal text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">for everyone</span>
            </Link>
            {user && (
              <div className="flex items-center gap-3">
                <LogoutButton />
                <Link
                  href="/upload"
                  className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-1.5"
                >
                  <span>+</span> 新規エピソード追加
                </Link>
              </div>
            )}
          </div>
        </header>
        <div className="flex-1 flex overflow-hidden min-h-0">
          {user && <Sidebar />}
          <main className="flex-1 overflow-y-auto bg-[#f8f9fa] p-6">{children}</main>
        </div>
        {user && <ChatWidget />}
      </body>
    </html>
  );
}
