import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { usePathname } from "next/navigation";
import { HeaderActions } from "@/components/HeaderActions";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

vi.mock("@/components/ChatWidget", () => ({
  ChatWidget: () => <div data-testid="chat-widget">ChatWidget</div>,
}));

describe("HeaderActions", () => {
  it("returns null when on root channel page '/'", () => {
    vi.mocked(usePathname).mockReturnValue("/");
    const html = renderToStaticMarkup(<HeaderActions />);
    expect(html).toBe("");
  });

  it("renders compact upload button on mobile with responsive text and plus icon", () => {
    vi.mocked(usePathname).mockReturnValue("/episodes");
    const html = renderToStaticMarkup(<HeaderActions />);

    expect(html).toContain('href="/upload"');
    expect(html).toContain("h-full px-2 sm:px-4");
    expect(html).toContain('<span class="hidden sm:inline">新規エピソード追加</span>');
    expect(html).toContain('title="新規エピソード追加"');
    expect(html).toContain('aria-label="新規エピソード追加"');
    expect(html).toContain("ChatWidget");
  });
});
