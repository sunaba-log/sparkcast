// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsForm } from "@/components/SettingsForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

describe("SettingsForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the API error when loading secrets fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "シークレットを取得できませんでした" }),
    });

    render(
      <SettingsForm
        podcastId={1}
        title="テスト番組"
        description="番組概要"
        rssFeedPath="/feed.xml"
        castMembers="A, B"
      />,
    );

    expect(
      await screen.findByText("シークレットを取得できませんでした"),
    ).toBeDefined();
  });

  it("shows a network error when the secrets request rejects", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ネットワークに接続できません"));

    render(
      <SettingsForm
        podcastId={1}
        title="テスト番組"
        description="番組概要"
        rssFeedPath="/feed.xml"
        castMembers="A, B"
      />,
    );

    expect(
      await screen.findByText("ネットワークに接続できません"),
    ).toBeDefined();
  });

  it("renders the AI audit toggle and sends updated audioAuditEnabled on save", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/secrets")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      }
      if (init?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    global.fetch = fetchMock;

    render(
      <SettingsForm
        podcastId={1}
        title="テスト番組"
        description="番組概要"
        rssFeedPath="/feed.xml"
        castMembers="A, B"
        audioAuditEnabled={true}
      />,
    );

    const toggleButton = screen.getByRole("switch", {
      name: "AI監査（ファクトチェック・ポリシー監査）を有効にする",
    });
    expect(toggleButton.getAttribute("aria-checked")).toBe("true");

    // Toggle off
    fireEvent.click(toggleButton);
    expect(toggleButton.getAttribute("aria-checked")).toBe("false");

    // Submit form
    const saveButton = screen.getByRole("button", { name: /設定を保存/ });
    fireEvent.click(saveButton);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/podcasts/1",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"audioAuditEnabled":false'),
      }),
    );
  });

  it("renders the AI audit toggle as disabled when initialAudioAuditEnabled is false", () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    render(
      <SettingsForm
        podcastId={1}
        title="テスト番組"
        description="番組概要"
        rssFeedPath="/feed.xml"
        castMembers="A, B"
        audioAuditEnabled={false}
      />,
    );

    const toggleButton = screen.getByRole("switch", {
      name: "AI監査（ファクトチェック・ポリシー監査）を有効にする",
    });
    expect(toggleButton.getAttribute("aria-checked")).toBe("false");
  });
});
