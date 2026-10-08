import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Image from "next/image";
import { HeaderActions } from "@/components/HeaderActions";
import { Sidebar, MobileNavProvider, MobileMenuButton } from "@/components/Sidebar";
import { getSessionUser } from "@/server/auth";
import { isRecordingEnabled } from "@/server/env";
import { getPodcast, listPodcastsForUser } from "@/server/podcasts/data-repository";
import { resolveEffectivePodcastId } from "@/server/podcasts/selection";
import { isLocalUiDemoEnabled } from "@/server/env";
import { UI_DEMO_PODCAST, UI_DEMO_PODCASTS } from "@/server/ui-demo";
import type { PodcastSummary } from "@/types/podcast";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#F6F7EB",
};

export const metadata: Metadata = {
  title: "SparkCast",
  description: "ポッドキャスト自動化管理ツール",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SparkCast",
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  let channelTitle: string | null = null;
  let podcasts: PodcastSummary[] = [];
  let selectedPodcastId: number | null = null;
  if (user?.registered) {
    if (isLocalUiDemoEnabled()) {
      podcasts = UI_DEMO_PODCASTS;
      selectedPodcastId = UI_DEMO_PODCAST.id;
      channelTitle = UI_DEMO_PODCAST.title;
    } else {
      podcasts = await listPodcastsForUser(user.uid);
      // Cookie 未設定時もデフォルトチャンネルを「選択中」として表示する
      const podcastId = await resolveEffectivePodcastId(user);
      if (podcastId) {
        selectedPodcastId = podcastId;
        channelTitle = (await getPodcast(podcastId))?.title ?? null;
      }
    }
  }
  return (
    <html lang="ja" className="h-dvh" suppressHydrationWarning>
      <body className="bg-app-bg text-gray-900 antialiased min-h-dvh h-dvh flex flex-col font-sans overflow-hidden">
        <MobileNavProvider>
          <header className="border-b border-brand/30 shrink-0 z-20 bg-app-bg pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
            <div className="w-full pl-3 sm:pl-5 h-8 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                {user && <MobileMenuButton />}
                <Link href="/" className="flex items-center hover:opacity-90 transition-opacity shrink-0">
                  <Image
                    src="/sparkcast_logo.svg"
                    alt="SparkCast"
                    width={168}
                    height={32}
                    priority
                    unoptimized
                    className="hidden sm:block h-5 w-auto"
                  />
                  <Image
                    src="/sparkcast_logo_small.svg"
                    alt="SparkCast"
                    width={29}
                    height={32}
                    priority
                    unoptimized
                    className="block sm:hidden h-5 w-auto"
                  />
                </Link>
              </div>
              {user && <HeaderActions />}
            </div>
          </header>
          <div className="flex-1 flex overflow-hidden min-h-0 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
            {user && (
              <Sidebar
                channelTitle={channelTitle}
                podcasts={podcasts}
                selectedPodcastId={selectedPodcastId}
                userDisplayName={user.displayName}
                userRegistered={user.registered}
                userIsAdmin={user.isAdmin}
                recordingEnabled={isRecordingEnabled() && user.canRecord}
              />
            )}
            <main className="notebook-grid flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-[calc(env(safe-area-inset-bottom)+1rem)] md:pb-6">
              {children}
            </main>
          </div>
        </MobileNavProvider>
      </body>
    </html>
  );
}
