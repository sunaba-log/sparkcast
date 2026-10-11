// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EpisodeMasterDetail } from "./EpisodeMasterDetail";
import type { Episode } from "@/types/episode";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const episode: Episode = {
  id: "42", podcastId: 1, title: "Audit pending", description: "", createdAt: "2026-10-11T00:00:00Z",
  status: "awaiting_approval", audioFileName: "audio.m4a", audioUrl: null,
  sourceAudioUrl: "/api/episodes/42/source-audio", artworkUrl: null, processingError: null,
  minutesGenerated: false, transcriptAvailable: false, xPostsGenerated: false, seedsGenerated: false,
  minutes: "", xPosts: [], conversationSeeds: [],
};
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith("policy-findings")
    ? { findings: [{ id: "f1", start: 25, end: 28, status: "pending", category: "pii" }] }
    : { interventions: [{ id: "i1", insertAt: 15, status: "pending", category: "fact" }] } })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("plays original audio at audit marker positions before approval", async () => {
  const { container } = render(<EpisodeMasterDetail initialEpisodes={[episode]} podcast={null} />);
  const audio = container.querySelector("audio")!;
  expect(audio.getAttribute("src")).toBe(episode.sourceAudioUrl);
  expect((screen.getByTitle("再生") as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(await screen.findByRole("button", { name: "ファクトチェック 00:15" }));
  expect(audio.currentTime).toBe(15);
  fireEvent.click(screen.getByRole("button", { name: "ポリシー監査 00:25" }));
  expect(audio.currentTime).toBe(25);
  expect(audio.play).toHaveBeenCalledTimes(2);
});
it("prefers completed audio", () => {
  const { container } = render(<EpisodeMasterDetail initialEpisodes={[{ ...episode, status: "completed", audioUrl: "https://example.com/edited.mp3" }]} podcast={null} />);
  expect(container.querySelector("audio")?.getAttribute("src")).toBe("https://example.com/edited.mp3");
});
it("disables playback when no source exists", () => {
  const { container } = render(<EpisodeMasterDetail initialEpisodes={[{ ...episode, sourceAudioUrl: null }]} podcast={null} />);
  expect(container.querySelector("audio")).toBeNull();
  expect((screen.getByTitle("再生") as HTMLButtonElement).disabled).toBe(true);
});
