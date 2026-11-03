import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";
import { getSessionUser } from "@/server/auth";
import { getDbPool } from "@/server/db";
import { requireSelectedPodcastForApi } from "@/server/podcasts/selection";
import { createAudioPreviewUrl } from "@/server/storage";
vi.mock("@/server/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/server/db", () => ({ getDbPool: vi.fn() }));
vi.mock("@/server/podcasts/selection", () => ({ requireSelectedPodcastForApi: vi.fn() }));
vi.mock("@/server/storage", () => ({ createAudioPreviewUrl: vi.fn() }));
const query = vi.fn();
const request = new Request("https://example.com/api/episodes/42/source-audio");
const context = { params: Promise.resolve({ id: "42" }) };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ uid: "user" } as never);
  vi.mocked(requireSelectedPodcastForApi).mockResolvedValue(1);
  vi.mocked(getDbPool).mockResolvedValue({ query } as never);
  query.mockResolvedValue({ rows: [{ source_audio_path: "podcasts/1/episodes/42/source/audio.m4a" }] });
  vi.mocked(createAudioPreviewUrl).mockResolvedValue("https://storage.example.com/audio.m4a?signature=test");
});
it("redirects to a signed source URL scoped to the selected podcast", async () => {
  const response = await GET(request, context);
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://storage.example.com/audio.m4a?signature=test");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(query).toHaveBeenCalledWith(expect.stringContaining("podcast_id = $1 AND episode_id = $2"), [1, 42]);
});
it("requires authentication", async () => {
  vi.mocked(getSessionUser).mockResolvedValue(null);
  expect((await GET(request, context)).status).toBe(401);
  expect(query).not.toHaveBeenCalled();
});
it("does not sign missing audio or audio from another podcast", async () => {
  query.mockResolvedValue({ rows: [] });
  expect((await GET(request, context)).status).toBe(404);
  expect(createAudioPreviewUrl).not.toHaveBeenCalled();
});
it("rejects invalid IDs", async () => {
  expect((await GET(request, { params: Promise.resolve({ id: "invalid" }) })).status).toBe(404);
  expect(query).not.toHaveBeenCalled();
});
