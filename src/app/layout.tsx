import type { Metadata } from "next";
import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { getSessionUser } from "@/server/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Podcast Automater",
  description: "ポッドキャスト自動化管理ツール",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <html lang="ja">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
            <Link href="/" className="text-lg font-bold tracking-tight text-gray-900 hover:text-blue-600 transition-colors">
              Podcast Automater
            </Link>
            {user && (
              <div className="flex items-center gap-4">
                <Link href="/agenda" className="text-sm text-gray-600 hover:text-blue-600">
                  アジェンダ
                </Link>
                <Link
                  href="/upload"
                  className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  + アップロード
                </Link>
                <LogoutButton />
              </div>
            )}
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
