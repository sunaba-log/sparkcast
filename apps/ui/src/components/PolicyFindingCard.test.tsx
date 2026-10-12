// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PolicyEditProposalCard } from "@/components/PolicyEditProposalCard";
import { groupPolicyFindings } from "@/lib/policy/proposals";
import type { PolicyEditProposal } from "@/types/episode";

const recording = vi.hoisted(() => ({ stop: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/recording/recorder", () => ({
  createTrackRecorder: (options: {
    onChunk: (chunk: { blob: Blob }) => void;
  }) => ({
    start: async () => undefined,
    stop: async () => {
      recording.stop();
      options.onChunk({ blob: new Blob(["pcm"], { type: "audio/wav" }) });
    },
  }),
}));
const [initial] = groupPolicyFindings([
  {
    id: "finding-1",
    chunkId: "seg_00001",
    category: "pii",
    source: "presidio",
    start: 126.2,
    end: 128.6,
    text: "連絡先は090-1234-5678です",
    evidenceText: "090-1234-5678",
    entityType: "電話番号",
    action: "silence",
    status: "pending",
  },
]);
const changed = vi.fn();
function Harness({ proposal = initial }: { proposal?: PolicyEditProposal }) {
  const [value, setValue] = useState(proposal);
  return (
    <PolicyEditProposalCard
      proposal={value}
      episodeId="3"
      version={1}
      disabled={false}
      canSeek
      onSeek={vi.fn()}
      onPlayRange={vi.fn()}
      onBusy={vi.fn()}
      onChange={(p) => {
        changed(p);
        setValue(p);
      }}
    />
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function expand() {
  fireEvent.click(screen.getByRole("button", { name: "編集案の詳細" }));
}
describe("unified policy finding card", () => {
  it("records, stops and releases the microphone before verifying the selected recording", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi
          .fn()
          .mockResolvedValue({
            getAudioTracks: () => [{}],
            getTracks: () => [{ stop: recording.release }],
          }),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              asset: {
                id: "asset-recorded",
                kind: "recorded",
                durationMs: 1000,
                transcript: "省略します",
                script: "省略します",
              },
              url: "https://example.test/recorded.wav",
            }),
            { status: 200 },
          ),
      ),
    );
    render(
      <Harness
        proposal={{ ...initial, action: "replace", script: "省略します" }}
      />,
    );
    expand();
    fireEvent.click(screen.getByRole("button", { name: "ブラウザ録音" }));
    fireEvent.click(screen.getByRole("button", { name: "録音する／取り直す" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "録音を停止・検証" }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "録音を停止・検証" }));
    await waitFor(() =>
      expect(screen.getByText(/挿入する音声（録音/)).toBeTruthy(),
    );
    expect(recording.stop).toHaveBeenCalled();
    expect(recording.release).toHaveBeenCalled();
    expect(changed.mock.lastCall?.[0].assetId).toBe("asset-recorded");
  });
  it("shows exact timestamp and evidence, with all three actions", () => {
    render(<Harness />);
    expect(screen.getByText("2:06.200 - 2:08.600")).toBeTruthy();
    expand();
    expect(screen.getByText("連絡先は090-1234-5678です")).toBeTruthy();
    expect(screen.queryByText(/検知箇所：/)).toBeNull();
    for (const name of ["カット", "無音化", "代替音声による置換"])
      expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "この編集案を承認",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("requires range confirmation and resets approval after range edits", () => {
    render(<Harness />);
    expand();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "対象範囲を確認した" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "この編集案を承認" }));
    expect(changed.mock.lastCall?.[0].status).toBe("approved");
    fireEvent.change(screen.getByLabelText("編集開始秒"), {
      target: { value: "126.1" },
    });
    expect(changed.mock.lastCall?.[0]).toMatchObject({
      status: "pending",
      rangeConfirmed: false,
    });
  });
  it("prepares and previews synthesized audio within the card and invalidates it on script edits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            asset: {
              id: "asset-1",
              kind: "synthesized",
              durationMs: 1500,
              transcript: "連絡先は伏せます",
              script: "連絡先は伏せます",
            },
            url: "https://example.test/asset.wav",
          }),
          { status: 200 },
        ),
      ),
    );
    render(<Harness />);
    expand();
    fireEvent.click(screen.getByRole("button", { name: "代替音声による置換" }));
    fireEvent.change(screen.getByLabelText("代替台詞"), {
      target: { value: "連絡先は伏せます" },
    });
    fireEvent.click(screen.getByRole("button", { name: "台詞から音声を生成" }));
    await waitFor(() => expect(screen.getByText(/挿入する音声/)).toBeTruthy());
    expect(screen.getByText("確認された発話：連絡先は伏せます")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("代替台詞"), {
      target: { value: "連絡先は省略します" },
    });
    expect(changed.mock.lastCall?.[0]).toMatchObject({
      assetId: null,
      status: "pending",
    });
    expect(screen.queryByText(/挿入する音声/)).toBeNull();
  });
});
