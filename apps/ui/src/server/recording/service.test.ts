import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingSession } from "@/server/recording/repository";
import type { RecordingDeps } from "@/server/recording/service";
import type { RoomTokenClaims } from "@/server/recording/tokens";

vi.mock("@/server/recording/repository", () => ({
  createRecordingSession: vi.fn(),
  createGuestParticipant: vi.fn(),
  getParticipant: vi.fn(),
  getRecordingSession: vi.fn(),
  markParticipantRemoved: vi.fn(),
  transitionSessionStatus: vi.fn(),
  updateParticipantDisplayName: vi.fn(),
  upsertHostParticipant: vi.fn(),
  upsertTrackSummaries: vi.fn(),
}));
vi.mock("@/server/recording/realtime-client", () => ({
  closeRoom: vi.fn().mockResolvedValue({ ok: true }),
  controlRoom: vi.fn(),
  kickParticipant: vi.fn(),
  snapshotManifest: vi.fn(),
}));
vi.mock("@/server/episodes/repository", () => ({
  createEpisodeRecord: vi.fn().mockResolvedValue(42),
  setEpisodeAudioFilePath: vi.fn(),
}));

const repository = await import("@/server/recording/repository");
const realtime = await import("@/server/recording/realtime-client");
const episodes = await import("@/server/episodes/repository");
const tokens = await import("@/server/recording/tokens");
const service = await import("@/server/recording/service");

const SECRET = "room-secret";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const GUEST_ID = "22222222-2222-4222-8222-222222222222";

function session(overrides: Partial<RecordingSession> = {}): RecordingSession {
  return {
    sessionId: SESSION_ID,
    podcastId: 7,
    hostUserId: "host-user",
    title: null,
    status: "waiting",
    maxParticipants: 6,
    recordingStartedAtMs: null,
    recordingStoppedAtMs: null,
    episodeId: null,
    error: null,
    expiresAt: new Date(Date.now() + 3600_000),
    createdAt: new Date(),
    ...overrides,
  };
}

function deps(overrides: Partial<RecordingDeps> = {}): RecordingDeps {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  return {
    pool: {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as RecordingDeps["pool"],
    roomSecret: SECRET,
    serviceSecret: "service-secret",
    realtimeBaseUrl: "https://realtime.example",
    mixerJobName: "projects/p/locations/r/jobs/mixer",
    maxParticipants: 6,
    roomTtlHours: 6,
    runMixerJob: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("joinAsGuest", () => {
  it("rejects an invite key for another session", async () => {
    vi.mocked(repository.getRecordingSession).mockResolvedValue(session());
    const otherKey = await tokens.createInviteKey("33333333-3333-4333-8333-333333333333", SECRET);
    await expect(
      service.joinAsGuest(deps(), {
        sessionId: SESSION_ID,
        inviteKey: otherKey,
        displayName: "ゲスト",
        consent: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INVITE" });
  });

  it("requires consent to recording", async () => {
    vi.mocked(repository.getRecordingSession).mockResolvedValue(session());
    await expect(
      service.joinAsGuest(deps(), {
        sessionId: SESSION_ID,
        inviteKey: await tokens.createInviteKey(SESSION_ID, SECRET),
        displayName: "ゲスト",
        consent: false,
      }),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  });

  it("reuses the same participant when the rejoin key matches", async () => {
    vi.mocked(repository.getRecordingSession).mockResolvedValue(session({ status: "recording" }));
    vi.mocked(repository.getParticipant).mockResolvedValue({
      participantId: GUEST_ID,
      sessionId: SESSION_ID,
      displayName: "ゲスト",
      role: "guest",
      userId: null,
      removedAt: null,
    });
    const result = await service.joinAsGuest(deps(), {
      sessionId: SESSION_ID,
      inviteKey: await tokens.createInviteKey(SESSION_ID, SECRET),
      displayName: "ゲスト",
      consent: true,
      participantId: GUEST_ID,
      rejoinKey: await tokens.createRejoinKey(GUEST_ID, SECRET),
    });
    expect(result.participantId).toBe(GUEST_ID);
    expect(repository.createGuestParticipant).not.toHaveBeenCalled();
    const claims = await tokens.verifyJwt<RoomTokenClaims>(
      result.token,
      SECRET,
      tokens.ROOM_TOKEN_AUDIENCE,
    );
    expect(claims).toMatchObject({ sid: SESSION_ID, pid: GUEST_ID, role: "guest" });
  });

  it("does not let a removed guest back in", async () => {
    vi.mocked(repository.getRecordingSession).mockResolvedValue(session({ status: "recording" }));
    vi.mocked(repository.getParticipant).mockResolvedValue({
      participantId: GUEST_ID,
      sessionId: SESSION_ID,
      displayName: "ゲスト",
      role: "guest",
      userId: null,
      removedAt: new Date(),
    });
    await expect(
      service.joinAsGuest(deps(), {
        sessionId: SESSION_ID,
        inviteKey: await tokens.createInviteKey(SESSION_ID, SECRET),
        displayName: "ゲスト",
        consent: true,
        participantId: GUEST_ID,
        rejoinKey: await tokens.createRejoinKey(GUEST_ID, SECRET),
      }),
    ).rejects.toMatchObject({ code: "REMOVED" });
  });

  it("does not accept new guests after the recording stopped", async () => {
    vi.mocked(repository.getRecordingSession).mockResolvedValue(session({ status: "uploading" }));
    await expect(
      service.joinAsGuest(deps(), {
        sessionId: SESSION_ID,
        inviteKey: await tokens.createInviteKey(SESSION_ID, SECRET),
        displayName: "ゲスト",
        consent: true,
      }),
    ).rejects.toMatchObject({ code: "CLOSED" });
  });
});

describe("controlRecording", () => {
  it("stores the server start time returned by the room", async () => {
    vi.mocked(realtime.controlRoom).mockResolvedValue({
      status: "recording",
      startedAtMs: 1_000,
      stoppedAtMs: null,
    });
    vi.mocked(repository.transitionSessionStatus).mockResolvedValue(
      session({ status: "recording", recordingStartedAtMs: 1_000 }),
    );
    const result = await service.controlRecording(deps(), session(), "start");
    expect(repository.transitionSessionStatus).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      ["waiting"],
      "recording",
      { recordingStartedAtMs: 1_000 },
    );
    expect(result.status).toBe("recording");
  });

  it("rejects stopping a session that is not recording", async () => {
    await expect(
      service.controlRecording(deps(), session({ status: "waiting" }), "stop"),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("finalizeRecording", () => {
  const manifest = {
    sessionId: SESSION_ID,
    recording: { startedAtMs: 1_000, stoppedAtMs: 61_000 },
    participants: [],
    chunks: [
      {
        kind: "local" as const,
        participantId: GUEST_ID,
        uploaderId: GUEST_ID,
        segment: "s1",
        seq: 0,
        segmentStartMs: 1_000,
        chunkStartMs: 1_000,
        durationMs: null,
        bytes: 100,
        sha256: "x",
        mime: "audio/webm",
        sampleRate: null,
        key: "k",
        uploadedAtMs: 2_000,
      },
    ],
  };

  it("locks the session, creates the episode and starts the mixer", async () => {
    vi.mocked(repository.transitionSessionStatus).mockResolvedValue(
      session({ status: "mixing" }),
    );
    vi.mocked(realtime.snapshotManifest).mockResolvedValue(manifest);
    const d = deps();
    const result = await service.finalizeRecording(d, session({ status: "uploading" }));

    expect(repository.transitionSessionStatus).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      SESSION_ID,
      ["uploading"],
      "mixing",
      { error: null },
    );
    expect(episodes.createEpisodeRecord).toHaveBeenCalledWith(expect.anything(), {
      podcastId: 7,
      title: expect.stringMatching(/^収録 /),
      fileName: "recording.flac",
    });
    expect(result).toEqual({
      episodeId: 42,
      objectPath: "podcasts/7/episodes/42/source/recording-11111111.flac",
    });
    expect(d.runMixerJob).toHaveBeenCalledWith("projects/p/locations/r/jobs/mixer", {
      sessionId: SESSION_ID,
      podcastId: 7,
      episodeId: 42,
      objectPath: "podcasts/7/episodes/42/source/recording-11111111.flac",
    });
  });

  it("refuses a second finalize while the first is running", async () => {
    vi.mocked(repository.transitionSessionStatus).mockResolvedValue(null);
    await expect(
      service.finalizeRecording(deps(), session({ status: "mixing" })),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(realtime.snapshotManifest).not.toHaveBeenCalled();
  });

  it("returns the session to uploading and fails the episode when the job cannot start", async () => {
    vi.mocked(repository.transitionSessionStatus).mockResolvedValue(
      session({ status: "mixing" }),
    );
    vi.mocked(realtime.snapshotManifest).mockResolvedValue(manifest);
    const d = deps({ runMixerJob: vi.fn().mockRejectedValue(new Error("boom")) });
    await expect(service.finalizeRecording(d, session({ status: "uploading" }))).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(repository.transitionSessionStatus).toHaveBeenLastCalledWith(
      expect.anything(),
      SESSION_ID,
      ["mixing"],
      "uploading",
      { error: "boom" },
    );
    expect(d.pool.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'failed'"),
      [42, expect.stringContaining("boom")],
    );
  });
});

describe("summarizeManifest", () => {
  it("counts segments, chunks and bytes per participant and kind", () => {
    const base = {
      participantId: GUEST_ID,
      uploaderId: GUEST_ID,
      seq: 0,
      segmentStartMs: 0,
      chunkStartMs: 0,
      durationMs: null,
      sha256: "x",
      mime: "audio/webm",
      sampleRate: null,
      key: "k",
      uploadedAtMs: 0,
    };
    const summary = service.summarizeManifest({
      sessionId: SESSION_ID,
      recording: { startedAtMs: 0, stoppedAtMs: 0 },
      participants: [],
      chunks: [
        { ...base, kind: "local", segment: "a", bytes: 10 },
        { ...base, kind: "local", segment: "a", seq: 1, bytes: 20 },
        { ...base, kind: "local", segment: "b", bytes: 5 },
        { ...base, kind: "backup", uploaderId: "host", segment: "c", bytes: 7 },
      ],
    });
    expect(summary).toEqual([
      { participantId: GUEST_ID, kind: "local", segmentCount: 2, chunkCount: 3, totalBytes: 35 },
      { participantId: GUEST_ID, kind: "backup", segmentCount: 1, chunkCount: 1, totalBytes: 7 },
    ]);
  });
});

describe("buildEpisodeTitle", () => {
  it("uses the session title or a JST date", () => {
    expect(service.buildEpisodeTitle(session({ title: " 第1回 " }))).toBe("第1回");
    expect(
      service.buildEpisodeTitle(session(), new Date("2026-10-03T16:00:00Z")),
    ).toBe("収録 2026/10/04");
  });
});
