// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
});
