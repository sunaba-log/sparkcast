import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { usePathname } from "next/navigation";
import { Sidebar, MobileNavProvider, MobileMenuButton } from "@/components/Sidebar";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    refresh: vi.fn(),
  })),
}));

vi.mock("./AccountMenu", () => ({
  AccountMenu: ({ displayName }: { displayName: string | null }) => (
    <div data-testid="account-menu">AccountMenu:{displayName}</div>
  ),
}));

describe("Sidebar and Mobile Navigation", () => {
  const dummyPodcasts = [
    {
      id: 1,
      title: "Tech Podcast",
      description: "A show about tech",
      coverImageUrl: null,
      rssFeedPath: "/feed.xml",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
    {
      id: 2,
      title: "Design Talks",
      description: "A show about design",
      coverImageUrl: null,
      rssFeedPath: "/feed2.xml",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
  ];

  it("renders MobileMenuButton with accessible attributes and mobile-only visibility", () => {
    vi.mocked(usePathname).mockReturnValue("/episodes");
    const html = renderToStaticMarkup(
      <MobileNavProvider>
        <MobileMenuButton />
      </MobileNavProvider>,
    );

    expect(html).toContain('id="mobile-menu-button"');
    expect(html).toContain('aria-label="メニューを開く"');
    expect(html).toContain('aria-controls="mobile-nav-drawer"');
    expect(html).toContain("md:hidden");
  });

  it("renders both desktop sidebar and mobile drawer overlay with full nav items", () => {
    vi.mocked(usePathname).mockReturnValue("/episodes");
    const html = renderToStaticMarkup(
      <MobileNavProvider>
        <Sidebar
          channelTitle="Tech Podcast"
          podcasts={dummyPodcasts}
          selectedPodcastId={1}
          userDisplayName="Taro"
          userRegistered={true}
          userIsAdmin={false}
          recordingEnabled={true}
        />
      </MobileNavProvider>,
    );

    // Desktop sidebar is hidden on screens smaller than md
    expect(html).toContain("hidden md:flex");

    // Mobile drawer is hidden on md and above, has dialog role and modal
    expect(html).toContain('id="mobile-nav-drawer"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="ナビゲーションメニュー"');
    expect(html).toContain("md:hidden");

    // Nav items
    expect(html).toContain('href="/episodes"');
    expect(html).toContain("エピソード");
    expect(html).toContain('href="/record"');
    expect(html).toContain("収録");
    expect(html).toContain('href="/sns"');
    expect(html).toContain("SNS投稿");
    expect(html).toContain('href="/agenda"');
    expect(html).toContain("次回議題");
    expect(html).toContain('href="/settings"');
    expect(html).toContain("番組設定");

    // Account menu included
    expect(html).toContain("AccountMenu:Taro");

    // Channel switcher included
    expect(html).toContain("Tech Podcast");
  });

  it("renders channel management link when on root page '/'", () => {
    vi.mocked(usePathname).mockReturnValue("/");
    const html = renderToStaticMarkup(
      <MobileNavProvider>
        <Sidebar
          channelTitle={null}
          podcasts={dummyPodcasts}
          selectedPodcastId={null}
          userDisplayName="Taro"
          userRegistered={true}
          userIsAdmin={false}
          recordingEnabled={false}
        />
      </MobileNavProvider>,
    );

    expect(html).toContain('href="/"');
    expect(html).toContain("チャンネル");
    // Other tabs should not appear on "/"
    expect(html).not.toContain('href="/sns"');
    expect(html).not.toContain('href="/agenda"');
  });
});
