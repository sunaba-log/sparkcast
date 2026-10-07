// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { UploadForm } from "@/components/UploadForm";
import { SettingsForm } from "@/components/SettingsForm";
import { ChannelManager } from "@/components/ChannelManager";
import { TopicProposalEditor } from "@/components/TopicProposalEditor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe("Forms mobile UX & accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("UploadForm", () => {
    it("has 16px mobile input size and 44px buttons and card dropzone", () => {
      render(<UploadForm podcastId={1} />);
      const titleInput = screen.getByPlaceholderText("未入力の場合はファイル名を仮タイトルにします");
      expect(titleInput.className).toContain("text-base");
      expect(titleInput.className).toContain("md:text-sm");

      const dropZone = screen.getByRole("button", { name: "音声ファイルを選択" });
      expect(dropZone).toBeDefined();
      expect(dropZone.className).toContain("rounded-lg");
      expect(dropZone.className).toContain("min-h-[140px]");

      const uploadButton = screen.getByRole("button", { name: "アップロード開始" });
      expect(uploadButton.className).toContain("min-h-[44px]");
    });
  });

  describe("SettingsForm", () => {
    it("ensures inputs have text-base md:text-sm and buttons have min-h-[44px]", () => {
      render(
        <SettingsForm
          podcastId={1}
          title="テスト番組"
          description="番組概要"
          rssFeedPath="/feed.xml"
          castMembers="A, B"
        />
      );
      const titleInput = screen.getByDisplayValue("テスト番組");
      expect(titleInput.className).toContain("text-base");
      expect(titleInput.className).toContain("md:text-sm");

      const descriptionTextarea = screen.getByDisplayValue("番組概要");
      expect(descriptionTextarea.className).toContain("text-base");
      expect(descriptionTextarea.className).toContain("md:text-sm");

      const saveButtons = screen.getAllByRole("button", { name: /設定を保存/ });
      expect(saveButtons[0].className).toContain("min-h-[44px]");
    });
  });

  describe("ChannelManager", () => {
    it("ensures new channel button and list buttons have 44px touch targets", () => {
      render(
        <ChannelManager
          podcasts={[
            {
              id: 1,
              title: "Channel 1",
              description: "Desc 1",
              coverImageUrl: null,
              rssFeedPath: "/feed",
              role: "owner",
            },
          ]}
          selectedPodcastId={1}
          defaultPodcastId={1}
        />
      );
      const newChannelBtn = screen.getByRole("button", { name: "新規チャンネル" });
      expect(newChannelBtn.className).toContain("min-h-[44px]");

      const starBtn = screen.getByRole("button", { name: /デフォルト/ });
      expect(starBtn.className).toContain("min-h-[44px]");
      expect(starBtn.className).toContain("min-w-[44px]");

      const episodesBtn = screen.getByRole("button", { name: "エピソード管理" });
      expect(episodesBtn.className).toContain("min-h-[44px]");

      const editBtn = screen.getByRole("button", { name: "チャンネルを編集" });
      expect(editBtn.className).toContain("min-h-[44px]");
      expect(editBtn.className).toContain("min-w-[44px]");

      const deleteBtn = screen.getByRole("button", { name: "チャンネルを削除" });
      expect(deleteBtn.className).toContain("min-h-[44px]");
      expect(deleteBtn.className).toContain("min-w-[44px]");
    });
  });

  describe("TopicProposalEditor", () => {
    it("ensures pagination buttons have 44px min height and form inputs have text-base md:text-sm", () => {
      render(
        <TopicProposalEditor
          proposals={[
            {
              id: "prop-1",
              podcastId: 1,
              targetPeriod: "2026-10-01",
              generatedAt: "2026-10-01T12:00:00Z",
              relatedNews: [
                {
                  title: "News 1",
                  url: "https://example.com",
                  summary: "Summary 1",
                  sourceReason: "Reason 1",
                },
              ],
              suggestedTopics: [
                {
                  title: "Topic 1",
                  description: "Topic Desc 1",
                  suggestedPoints: ["Point 1"],
                  relatedPastEpisodes: [1],
                },
              ],
            },
          ]}
        />
      );

      const prevBtn = screen.getByRole("button", { name: /Previous/ });
      expect(prevBtn.className).toContain("min-h-[44px]");

      const dateBtn = screen.getByRole("button", { name: "2026-10-01" });
      expect(dateBtn.className).toContain("min-h-[44px]");

      const titleTextarea = screen.getByDisplayValue("Topic 1");
      expect(titleTextarea.className).toContain("text-base");
      expect(titleTextarea.className).toContain("md:text-sm");

      const addPointBtn = screen.getByRole("button", { name: /新規提案ポイントを追加/ });
      expect(addPointBtn.className).toContain("min-h-[44px]");

      const saveBtn = screen.getByRole("button", { name: "保存" });
      expect(saveBtn.className).toContain("min-h-[44px]");
    });
  });
});
