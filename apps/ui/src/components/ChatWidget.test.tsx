// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatWidget } from "@/components/ChatWidget";

describe("ChatWidget mobile UX & accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessions: [] }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders closed by default and toggle button has full header height", () => {
    render(<ChatWidget />);
    const toggleButton = screen.getByRole("button", { name: "チャットを開く" });
    expect(toggleButton).toBeDefined();
    expect(toggleButton.className).toContain("h-full");
  });

  it("applies full-screen modal classes on mobile and floating width on desktop when opened", () => {
    render(<ChatWidget />);
    const toggleButton = screen.getByRole("button", { name: "チャットを開く" });
    fireEvent.click(toggleButton);

    const closeButtons = screen.getAllByRole("button", { name: "チャットを閉じる" });
    expect(closeButtons.length).toBe(2);
    // Modal header close button has min-w/min-h 44px, header toggle button fits header height
    expect(closeButtons[0].className).toContain("min-w-[44px]");
    expect(closeButtons[0].className).toContain("min-h-[44px]");
    expect(closeButtons[1].className).toContain("h-full");

    // The modal container
    const modalContainer = closeButtons[0].closest(".fixed");
    expect(modalContainer).not.toBeNull();
    // Mobile full-screen modal classes
    expect(modalContainer?.className).toContain("inset-0");
    expect(modalContainer?.className).toContain("h-[100dvh]");
    // Desktop floating panel classes
    expect(modalContainer?.className).toContain("md:w-[36rem]");
    expect(modalContainer?.className).toContain("md:top-16");
    expect(modalContainer?.className).toContain("md:right-6");
  });

  it("ensures textarea has text-base md:text-sm to prevent iOS Safari auto zoom", () => {
    render(<ChatWidget />);
    fireEvent.click(screen.getByRole("button", { name: "チャットを開く" }));

    const textarea = screen.getByPlaceholderText("質問や相談を入力…");
    expect(textarea.className).toContain("text-base");
    expect(textarea.className).toContain("md:text-sm");
  });

  it("ensures action buttons have at least 44px touch target height", () => {
    render(<ChatWidget />);
    fireEvent.click(screen.getByRole("button", { name: "チャットを開く" }));

    const sendButton = screen.getByRole("button", { name: "送信" });
    expect(sendButton.className).toContain("min-h-[44px]");

    const newChatButton = screen.getByRole("button", { name: "新しいチャット" });
    expect(newChatButton.className).toContain("min-h-[44px]");

    const historyButton = screen.getByRole("button", { name: "履歴を開く" });
    expect(historyButton.className).toContain("min-h-[44px]");
    expect(historyButton.className).toContain("min-w-[44px]");
  });
});
