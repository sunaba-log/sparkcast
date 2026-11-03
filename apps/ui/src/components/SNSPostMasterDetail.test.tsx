// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  SNSPostMasterDetail,
  sortPostsDesc,
  getPostSortTimestamp,
  type SNSPostItem,
} from "./SNSPostMasterDetail";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const samplePosts: SNSPostItem[] = [
  {
    id: "post-old",
    episodeId: "1",
    episodeTitle: "エピソード1 初回放送",
    status: "posted",
    scheduledDate: { yyyy: "2026", mm: "09", dd: "15", hh: "10", min: "00" },
    message: "エピソード1の告知です https://example.com/long-url-1234567890",
    platformUrls: { apple: "", amazon: "", spotify: "" },
    hashtags: ["#podcast"],
    generatedAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
  },
  {
    id: "post-newest",
    episodeId: "3",
    episodeTitle: "エピソード3 最新回",
    status: "pending",
    scheduledDate: { yyyy: "2026", mm: "10", dd: "08", hh: "18", min: "30" },
    message: "最新エピソードを公開しました！ https://sparkcast.jp/episodes/3?utm_source=twitter&utm_medium=sns&utm_campaign=launch_promo_2026_very_long_url",
    platformUrls: { apple: "", amazon: "", spotify: "" },
    hashtags: ["#news"],
    generatedAt: "2026-10-08T18:30:00Z",
    updatedAt: "2026-10-08T18:30:00Z",
  },
  {
    id: "post-middle",
    episodeId: "2",
    episodeTitle: "エピソード2 中間回",
    status: "pending",
    scheduledDate: { yyyy: "2026", mm: "10", dd: "05", hh: "12", min: "00" },
    message: "エピソード2の投稿です",
    platformUrls: { apple: "", amazon: "", spotify: "" },
    hashtags: [],
    generatedAt: "2026-10-05T12:00:00Z",
    updatedAt: "2026-10-05T12:00:00Z",
  },
];

describe("sortPostsDesc & getPostSortTimestamp", () => {
  it("computes sort timestamp correctly from scheduledDate", () => {
    const post = samplePosts[1]; // 2026-10-08 18:30
    const ts = getPostSortTimestamp(post);
    expect(ts).toBe(new Date("2026-10-08T18:30:00").getTime());
  });

  it("sorts posts in descending order of scheduledDate", () => {
    const sorted = sortPostsDesc(samplePosts);
    expect(sorted.map((p) => p.id)).toEqual(["post-newest", "post-middle", "post-old"]);
  });

  it("handles same day different time correctly", () => {
    const morning: SNSPostItem = {
      ...samplePosts[0],
      id: "morning",
      scheduledDate: { yyyy: "2026", mm: "10", dd: "08", hh: "09", min: "00" },
    };
    const evening: SNSPostItem = {
      ...samplePosts[0],
      id: "evening",
      scheduledDate: { yyyy: "2026", mm: "10", dd: "08", hh: "19", min: "00" },
    };
    const sorted = sortPostsDesc([morning, evening]);
    expect(sorted[0].id).toBe("evening");
    expect(sorted[1].id).toBe("morning");
  });

  it("falls back to generatedAt when scheduledDate is missing", () => {
    const postWithoutDate: SNSPostItem = {
      ...samplePosts[0],
      id: "no-date",
      scheduledDate: { yyyy: "", mm: "", dd: "", hh: "", min: "" },
      generatedAt: "2026-10-07T10:00:00Z",
    };
    const postWithDate: SNSPostItem = {
      ...samplePosts[0],
      id: "has-date",
      scheduledDate: { yyyy: "2026", mm: "10", dd: "06", hh: "10", min: "00" },
      generatedAt: "2026-10-06T10:00:00Z",
    };
    const sorted = sortPostsDesc([postWithDate, postWithoutDate]);
    expect(sorted[0].id).toBe("no-date");
    expect(sorted[1].id).toBe("has-date");
  });
});

describe("SNSPostMasterDetail layout & responsive styling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders container query and responsive classes on timeline elements", () => {
    const { container } = render(<SNSPostMasterDetail initialPosts={samplePosts} />);

    // Left column container has @container
    const listContainer = container.querySelector(".\\@container");
    expect(listContainer).not.toBeNull();

    // Timeline item wrapper has min-w-0 and w-full
    const itemWrapper = container.querySelector(".min-w-0.w-full");
    expect(itemWrapper).not.toBeNull();

    // Content wrapper has flex-col @[500px]:flex-row and min-w-0 w-full
    const contentWrapper = container.querySelector(".flex-col.\\@\\[500px\\]\\:flex-row");
    expect(contentWrapper).not.toBeNull();
    expect(contentWrapper?.className).toContain("min-w-0");
    expect(contentWrapper?.className).toContain("w-full");

    // Post preview card has w-full min-w-0 @[500px]:flex-1
    const card = container.querySelector(".w-full.min-w-0.\\@\\[500px\\]\\:flex-1");
    expect(card).not.toBeNull();

    // Message tag has break-words and [overflow-wrap:anywhere]
    const messageP = container.querySelector(".break-words");
    expect(messageP).not.toBeNull();
    expect(messageP?.className).toContain("[overflow-wrap:anywhere]");

    // Episode title tag has truncate and min-w-0
    const titleSpan = container.querySelector(".truncate.min-w-0");
    expect(titleSpan).not.toBeNull();
  });

  it("keeps the inspector actions at the bottom while its content fills the remaining height", () => {
    render(<SNSPostMasterDetail initialPosts={samplePosts} />);

    const content = screen.getByTestId("sns-inspector-content");
    expect(content.className).toContain("min-h-0");
    expect(content.className).toContain("flex-1");
    expect(content.className).toContain("overflow-y-auto");

    const actions = screen.getByTestId("sns-inspector-actions");
    expect(actions.className).toContain("mt-auto");
    expect(actions.className).toContain("shrink-0");
  });

  it("initially selects the newest post by default in descending order", () => {
    render(<SNSPostMasterDetail initialPosts={samplePosts} />);

    // The newest post is "post-newest" (episode 3)
    // The message textarea in Inspector should display the newest post message
    const textarea = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    expect(textarea.value).toBe(samplePosts[1].message);
  });

  it("honors initialSelectedId for deep linking", () => {
    render(
      <SNSPostMasterDetail
        initialPosts={samplePosts}
        initialSelectedId="post-old"
      />
    );

    const textarea = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    expect(textarea.value).toBe(samplePosts[0].message);
  });

  it("switches selected post when clicking a card in the timeline", () => {
    render(<SNSPostMasterDetail initialPosts={samplePosts} />);

    // Click on post-middle
    const middlePostCard = screen.getByText("エピソード2の投稿です");
    fireEvent.click(middlePostCard);

    const textarea = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    expect(textarea.value).toBe(samplePosts[2].message);
  });
});
