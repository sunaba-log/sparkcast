import { describe, expect, it } from "vitest";
import {
  buildMinutesContext,
  buildRetrievedContext,
} from "@/server/chat/minutes-context";
import type { EpisodeKnowledge } from "@/server/chat/minutes-repository";

function knowledge(
  overrides: Partial<EpisodeKnowledge> & Pick<EpisodeKnowledge, "episodeId">,
): EpisodeKnowledge {
  return {
    title: `エピソード${overrides.episodeId}`,
    createdAt: "2026-06-01T00:00:00.000Z",
    content: "本文",
    ...overrides,
  };
}

describe("buildMinutesContext", () => {
  it("formats episodes with id and title headers", () => {
    const context = buildMinutesContext([
      knowledge({ episodeId: 3, title: "DB選定", content: "Cloud SQLの話" }),
    ]);
    expect(context).toContain("## エピソード 3: DB選定");
    expect(context).toContain("Cloud SQLの話");
  });

  it("returns an empty string when there are no episodes", () => {
    expect(buildMinutesContext([])).toBe("");
  });

  it("truncates per-episode content beyond the limit", () => {
    const context = buildMinutesContext(
      [knowledge({ episodeId: 1, content: "あ".repeat(100) })],
      { maxPerEpisodeChars: 10 },
    );
    expect(context).toContain("…（以下省略）");
    expect(context).not.toContain("あ".repeat(11));
  });

  it("stops adding episodes once the total budget is exceeded", () => {
    const context = buildMinutesContext(
      [
        knowledge({ episodeId: 1, content: "x".repeat(50) }),
        knowledge({ episodeId: 2, content: "y".repeat(50) }),
      ],
      { maxTotalChars: 100 },
    );
    expect(context).toContain("## エピソード 1");
    expect(context).not.toContain("## エピソード 2");
  });
});

describe("buildRetrievedContext", () => {
  it("groups chunks from the same episode under one header", () => {
    const context = buildRetrievedContext([
      { episodeId: 5, episodeTitle: "DB選定", text: "前半の話" },
      { episodeId: 5, episodeTitle: "DB選定", text: "後半の話" },
    ]);
    expect(context.match(/## エピソード 5: DB選定/g)).toHaveLength(1);
    expect(context).toContain("前半の話");
    expect(context).toContain("後半の話");
  });

  it("skips empty chunks and returns empty string when nothing remains", () => {
    expect(buildRetrievedContext([])).toBe("");
    expect(
      buildRetrievedContext([{ episodeId: 1, episodeTitle: "t", text: "  " }]),
    ).toBe("");
  });
});
