import { BehaviorSubject, of, type Subscription } from "rxjs";
import type { PartyTracks as PartyTracksType, TrackMetadata } from "partytracks/client";
import { openChunkStore, chunkId, type ChunkStore } from "@/lib/recording/chunk-store";
import { LevelMonitor } from "@/lib/recording/levels";
import { VoiceWarnings, type VoiceWarning } from "@/lib/recording/voice-warnings";
import {
  CHAT_MAX_LENGTH,
  type ChatMessage,
  type MicState,
  type RecorderState,
  type RoomState,
} from "@/lib/recording/protocol";

// 画面に残すチャットの件数
const CHAT_KEEP = 200;
import { createTrackRecorder, type RecordedChunk, type TrackRecorder } from "@/lib/recording/recorder";
import { RoomConnection, type ConnectionStatus, type EndReason } from "@/lib/recording/room-connection";
import type { JoinResponse } from "@/lib/recording/types";
import { ChunkUploader } from "@/lib/recording/uploader";

// 収録ルームのブラウザ側の司令塔（#166）。
// WebSocket（在室・開始/停止）、SFU（通話）、録音（本人のマイク・ホストはバックアップも）、
// アップロード（IndexedDB 経由で再送）をまとめ、React には snapshot を渡す。

export type ControllerSnapshot = {
  connection: ConnectionStatus;
  ended: EndReason | null;
  self: { pid: string; role: "host" | "guest"; name: string };
  room: RoomState | null;
  muted: boolean;
  mic: MicState;
  recorder: RecorderState;
  recorderFormat: "mediarecorder" | "wav" | null;
  upload: { pending: number; uploaded: number; lastError: string | null };
  backupPending: number;
  flushed: boolean;
  clock: { offsetMs: number | null; rttMs: number | null };
  call: RTCPeerConnectionState | "new";
  audioBlocked: boolean;
  persistentStorage: boolean;
  wakeLock: boolean;
  levels: Record<string, number>;
  // 自分の声の警告（音が割れている・ミュートのまま話している）
  voiceWarning: VoiceWarning | null;
  // 収録中のテキストチャット（ルームを閉じたら消える）
  chat: ChatMessage[];
  chatError: string | null;
  error: string | null;
};

export type ControllerOptions = {
  join: JoinResponse;
  micTrack: MediaStreamTrack;
  micDeviceId: string | null;
  // ヘッドホン（イヤホン）を使うか。使うならエコー除去を切る
  headphones: boolean;
  // 期限切れ前のトークン更新（ホストは join API、ゲストは再入室キーで取り直す）
  refreshJoin: () => Promise<JoinResponse>;
  audioContainer: HTMLElement;
};

// マイクの設定。ヘッドホンなら相手の声がマイクに回り込まないので、声を削るエコー除去を切る
// （スピーカーで聞くときだけ必要。Riverside・Zencastr も同じ勧め方）
export function micConstraints(headphones: boolean): MediaTrackConstraints {
  return {
    channelCount: 1,
    sampleRate: 48_000,
    echoCancellation: !headphones,
    noiseSuppression: true,
    autoGainControl: false,
  };
}

type Pulled = {
  key: string;
  subscription: Subscription;
  track: MediaStreamTrack | null;
  audio: HTMLAudioElement;
};

export class RecordingController {
  private listeners = new Set<() => void>();
  private snapshot: ControllerSnapshot;
  private join: JoinResponse;
  private headers: Headers;
  private connection: RoomConnection;
  private store: ChunkStore | null = null;
  private uploader: ChunkUploader | null = null;
  private backupUploader: ChunkUploader | null = null;
  private partyTracks: PartyTracksType | null = null;
  private mic$: BehaviorSubject<MediaStreamTrack>;
  private micTrack: MediaStreamTrack;
  private pushSubscription: Subscription | null = null;
  private lastTrack: { sessionId: string; trackName: string } | null = null;
  private pulled = new Map<string, Pulled>();
  private localRecorder: TrackRecorder | null = null;
  private localRecorderStarting = false;
  private backupRecorders = new Map<string, { trackId: string; recorder: TrackRecorder }>();
  private levels = new LevelMonitor();
  private voice = new VoiceWarnings();
  // 自分のメーター用のマイクの写し。ミュート（enabled=false）中も声を測れるようにする
  private meterTrack: MediaStreamTrack | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private disposed = false;
  private cleanupFns: (() => void)[] = [];

  constructor(private readonly options: ControllerOptions) {
    this.join = options.join;
    this.headers = new Headers({ Authorization: `Bearer ${options.join.token}` });
    this.micTrack = options.micTrack;
    this.mic$ = new BehaviorSubject(options.micTrack);
    this.snapshot = {
      connection: "connecting",
      ended: null,
      self: { pid: options.join.participantId, role: options.join.role, name: options.join.displayName },
      room: null,
      muted: false,
      mic: "live",
      recorder: "idle",
      recorderFormat: null,
      upload: { pending: 0, uploaded: 0, lastError: null },
      backupPending: 0,
      flushed: false,
      clock: { offsetMs: null, rttMs: null },
      call: "new",
      audioBlocked: false,
      persistentStorage: false,
      wakeLock: false,
      levels: {},
      voiceWarning: null,
      chat: [],
      chatError: null,
      error: null,
    };
    this.connection = new RoomConnection(options.join.realtimeBaseUrl, options.join.sessionId, options.join.token, {
      onStatus: (connection) => {
        this.update({ connection });
        if (connection === "open" && this.lastTrack) {
          this.connection.send({ type: "track", ...this.lastTrack });
        }
      },
      onState: (room) => this.handleRoomState(room),
      onChat: (messages, history) => {
        if (history) {
          this.update({ chat: messages });
          return;
        }
        const known = new Set(this.snapshot.chat.map((message) => message.id));
        const fresh = messages.filter((message) => !known.has(message.id));
        if (fresh.length > 0) this.update({ chat: [...this.snapshot.chat, ...fresh].slice(-CHAT_KEEP), chatError: null });
      },
      onChatError: (message) => this.update({ chatError: message }),
      onEnded: (ended) => this.handleEnded(ended),
    });
  }

  // ---- React 連携 ----

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private update(patch: Partial<ControllerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  // ---- 開始・終了 ----

  async start() {
    const { store, persistent } = await openChunkStore();
    this.store = store;
    this.update({ persistentStorage: persistent });

    const uploaderBase = {
      baseUrl: this.join.realtimeBaseUrl,
      sessionId: this.join.sessionId,
      store,
      getToken: () => this.join.token,
      onUnauthorized: () => this.refreshToken(),
    };
    this.uploader = new ChunkUploader({
      ...uploaderBase,
      uploaderId: this.join.participantId,
      onChange: (upload) => {
        this.update({ upload });
        this.reportStatus();
      },
    });
    await this.uploader.resume();

    this.connection.connect();
    this.watchMic(this.micTrack);
    this.meterSelf(this.micTrack);
    await this.startCall();
    this.installPageHandlers();
    await this.acquireWakeLock();
    this.scheduleRefresh();

    this.timers.push(
      setInterval(() => {
        const samples = this.levels.readDetailed();
        const levels: Record<string, number> = {};
        for (const [key, sample] of Object.entries(samples)) levels[key] = sample.level;
        const self = samples[this.join.participantId];
        // ミュート中の自分のメーターは 0 にする（測るのは警告のため）
        if (self && this.snapshot.muted) levels[this.join.participantId] = 0;
        this.update({
          levels,
          voiceWarning: self ? this.voice.update({ ...self, muted: this.snapshot.muted }, Date.now()) : null,
          clock: { offsetMs: this.connection.clock.offsetMs, rttMs: this.connection.clock.bestRttMs },
        });
      }, 120),
    );
    // 何も変わらなくても在室を伝える
    this.timers.push(setInterval(() => this.reportStatus(true), 10_000));
  }

  async leave() {
    if (this.disposed) return;
    this.disposed = true;
    await this.stopAllRecorders();
    this.connection.close();
    this.pushSubscription?.unsubscribe();
    for (const pulled of this.pulled.values()) this.removePull(pulled);
    this.pulled.clear();
    this.levels.close();
    this.meterTrack?.stop();
    for (const timer of this.timers) clearInterval(timer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    for (const cleanup of this.cleanupFns) cleanup();
    await this.wakeLock?.release().catch(() => undefined);
    this.uploader?.stop();
    this.backupUploader?.stop();
    this.micTrack.stop();
  }

  setMuted(muted: boolean) {
    this.micTrack.enabled = !muted;
    this.update({ muted, mic: muted ? "muted" : this.micTrack.muted ? "interrupted" : "live" });
    this.reportStatus();
  }

  // チャットを送る（つながっていないときは送れない）
  sendChat(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || this.snapshot.connection !== "open") return false;
    this.update({ chatError: null });
    this.connection.send({ type: "chat", text: trimmed.slice(0, CHAT_MAX_LENGTH) });
    return true;
  }

  // マイクがほかのタブやアプリに取られて止まったとき、ユーザー操作で取り直す
  async retryMic() {
    this.levels.resume();
    await this.reacquireMic();
  }

  // 自動再生が止められたとき、ユーザー操作で再生し直す
  async unlockAudio() {
    this.levels.resume();
    const results = await Promise.all(
      [...this.pulled.values()].map((pulled) => pulled.audio.play().then(() => true).catch(() => false)),
    );
    this.update({ audioBlocked: results.some((ok) => !ok) });
  }

  // ---- トークン ----

  private scheduleRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const msUntilExpiry = this.join.tokenExpiresAt * 1000 - Date.now();
    const delay = Math.max(30_000, msUntilExpiry - 10 * 60 * 1000);
    this.refreshTimer = setTimeout(() => {
      void this.refreshToken();
    }, delay);
  }

  private refreshing: Promise<void> | null = null;

  private refreshToken(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const join = await this.options.refreshJoin();
          this.join = join;
          this.headers.set("Authorization", `Bearer ${join.token}`);
          this.connection.updateToken(join.token);
          this.scheduleRefresh();
        } catch (error) {
          this.update({ error: error instanceof Error ? error.message : "トークンの更新に失敗しました" });
          this.refreshTimer = setTimeout(() => void this.refreshToken(), 30_000);
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }

  // ---- 通話（SFU） ----

  private async startCall() {
    try {
      const prefix = `${this.join.realtimeBaseUrl}/rooms/${this.join.sessionId}/sfu`;
      // ICE サーバーは認証付きで自分で取る（partytracks の取得は Authorization を付けないため）
      const ice = await fetch(`${prefix}/generate-ice-servers`, { headers: this.headers });
      const { iceServers } = (await ice.json()) as { iceServers: RTCIceServer[] };
      const { PartyTracks } = await import("partytracks/client");
      const partyTracks = new PartyTracks({ prefix, headers: this.headers, iceServers });
      this.partyTracks = partyTracks;
      const stateSubscription = partyTracks.peerConnectionState$.subscribe((call) => this.update({ call }));
      this.cleanupFns.push(() => stateSubscription.unsubscribe());
      this.pushSubscription = partyTracks
        .push(this.mic$, { sendEncodings$: of([{ maxBitrate: 32_000 }]) })
        .subscribe((metadata: TrackMetadata) => {
          if (!metadata.sessionId || !metadata.trackName) return;
          this.lastTrack = { sessionId: metadata.sessionId, trackName: metadata.trackName };
          this.connection.send({ type: "track", ...this.lastTrack });
        });
    } catch (error) {
      this.update({ error: `通話の接続に失敗しました: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  private syncPulls(room: RoomState) {
    if (!this.partyTracks) return;
    const wanted = new Map<string, { pid: string; sessionId: string; trackName: string }>();
    for (const participant of room.participants) {
      if (participant.pid === this.join.participantId || !participant.track || !participant.connected) continue;
      wanted.set(participant.pid, { pid: participant.pid, ...participant.track });
    }
    for (const [pid, pulled] of this.pulled) {
      const target = wanted.get(pid);
      if (!target || pulled.key !== `${target.sessionId}/${target.trackName}`) {
        this.removePull(pulled);
        this.pulled.delete(pid);
      }
    }
    for (const [pid, target] of wanted) {
      if (this.pulled.has(pid)) continue;
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "");
      this.options.audioContainer.appendChild(audio);
      const pulled: Pulled = {
        key: `${target.sessionId}/${target.trackName}`,
        track: null,
        audio,
        subscription: this.partyTracks
          .pull(of({ location: "remote", sessionId: target.sessionId, trackName: target.trackName }))
          .subscribe((track) => {
            pulled.track = track;
            audio.srcObject = new MediaStream([track]);
            audio.play().then(
              () => undefined,
              () => this.update({ audioBlocked: true }),
            );
            this.levels.set(pid, track);
            this.syncBackups();
          }),
      };
      this.pulled.set(pid, pulled);
    }
    this.syncBackups();
  }

  private removePull(pulled: Pulled) {
    pulled.subscription.unsubscribe();
    pulled.audio.srcObject = null;
    pulled.audio.remove();
    for (const [pid, candidate] of this.pulled) {
      if (candidate === pulled) this.levels.set(pid, null);
    }
  }

  // ---- 録音 ----

  private handleRoomState(room: RoomState) {
    const previous = this.snapshot.room;
    this.update({ room });
    this.syncPulls(room);

    if (room.status === "recording") {
      void this.ensureLocalRecorder();
    } else if ((room.status === "stopped" || room.status === "closed") && previous?.status === "recording") {
      void this.stopAllRecorders().then(() => this.reportStatus());
    } else if (room.status === "stopped" && !this.localRecorder) {
      // 停止後に入り直した端末も、送り残しが無いことを伝える
      this.reportStatus();
    }
  }

  private serverNow = () => this.connection.clock.serverNow();

  private async ensureLocalRecorder() {
    if (this.localRecorder || this.localRecorderStarting || this.disposed) return;
    if (this.micTrack.readyState !== "live") return;
    this.localRecorderStarting = true;
    try {
      const recorder = createTrackRecorder({
        track: this.micTrack,
        serverNow: this.serverNow,
        onChunk: (chunk) => this.enqueue("local", this.join.participantId, chunk),
        onError: () => {
          this.update({ recorder: "error" });
          this.reportStatus();
        },
      });
      await recorder.start();
      this.localRecorder = recorder;
      this.update({ recorder: "recording", recorderFormat: recorder.format, flushed: false });
      this.reportStatus();
    } catch (error) {
      this.update({ recorder: "error", error: `録音を開始できませんでした: ${String(error)}` });
      this.reportStatus();
    } finally {
      this.localRecorderStarting = false;
    }
  }

  // ホストは、受信している他の参加者の音声も話者ごとに録っておく（ゲスト側の欠損の補完用）
  private syncBackups() {
    if (this.join.role !== "host") return;
    const recording = this.snapshot.room?.status === "recording";
    for (const [pid, backup] of this.backupRecorders) {
      const pulled = this.pulled.get(pid);
      if (!recording || !pulled?.track || pulled.track.id !== backup.trackId) {
        this.backupRecorders.delete(pid);
        void backup.recorder.stop();
      }
    }
    if (!recording) return;
    for (const [pid, pulled] of this.pulled) {
      if (!pulled.track || this.backupRecorders.has(pid)) continue;
      const recorder = createTrackRecorder({
        track: pulled.track,
        serverNow: this.serverNow,
        bitsPerSecond: 64_000,
        onChunk: (chunk) => this.enqueue("backup", pid, chunk),
      });
      this.backupRecorders.set(pid, { trackId: pulled.track.id, recorder });
      void recorder.start().catch(() => this.backupRecorders.delete(pid));
    }
  }

  private enqueue(kind: "local" | "backup", subject: string, chunk: RecordedChunk) {
    const meta = {
      sessionId: this.join.sessionId,
      uploaderId: this.join.participantId,
      kind,
      subject,
      segment: chunk.segment,
      seq: chunk.seq,
      segmentStartMs: chunk.segmentStartMs,
      chunkStartMs: chunk.chunkStartMs,
      durationMs: chunk.durationMs,
      sampleRate: chunk.sampleRate,
      mime: chunk.mime,
      createdAt: Date.now(),
    };
    void this.uploader?.enqueue({ ...meta, id: chunkId(meta), blob: chunk.blob });
  }

  private async stopAllRecorders() {
    const local = this.localRecorder;
    this.localRecorder = null;
    const backups = [...this.backupRecorders.values()];
    this.backupRecorders.clear();
    await Promise.all([local?.stop(), ...backups.map((backup) => backup.recorder.stop())]);
    if (local) this.update({ recorder: "idle" });
  }

  private reportStatus(force = false) {
    const pending = this.uploader?.pending ?? 0;
    const status = this.snapshot.room?.status;
    const flushed =
      (status === "stopped" || status === "closed") && !this.localRecorder && this.backupRecorders.size === 0 && pending === 0;
    if (flushed !== this.snapshot.flushed) this.update({ flushed });
    if (!this.connection.isOpen && !force) return;
    this.connection.send({
      type: "status",
      mic: this.snapshot.muted ? "muted" : this.snapshot.mic,
      recorder: this.localRecorder ? "recording" : this.snapshot.recorder === "error" ? "error" : "idle",
      pendingChunks: pending,
      flushed,
    });
  }

  // ---- マイクの途切れ（iPhone の画面ロック・アプリ切替・デバイスの抜き差し） ----

  private watchMic(track: MediaStreamTrack) {
    const onMute = () => {
      if (!this.snapshot.muted) this.update({ mic: "interrupted" });
      this.reportStatus();
    };
    const onUnmute = () => {
      if (!this.snapshot.muted) this.update({ mic: "live" });
      this.reportStatus();
    };
    const onEnded = () => {
      this.update({ mic: "ended" });
      this.reportStatus();
      void this.reacquireMic();
    };
    track.addEventListener("mute", onMute);
    track.addEventListener("unmute", onUnmute);
    track.addEventListener("ended", onEnded);
    this.cleanupFns.push(() => {
      track.removeEventListener("mute", onMute);
      track.removeEventListener("unmute", onUnmute);
      track.removeEventListener("ended", onEnded);
    });
  }

  private meterSelf(track: MediaStreamTrack) {
    this.meterTrack?.stop();
    this.meterTrack = track.clone();
    this.meterTrack.enabled = true;
    this.levels.set(this.join.participantId, this.meterTrack);
  }

  private reacquiring = false;

  private async reacquireMic() {
    if (this.reacquiring || this.disposed) return;
    this.reacquiring = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...micConstraints(this.options.headphones),
          ...(this.options.micDeviceId ? { deviceId: { ideal: this.options.micDeviceId } } : {}),
        },
      });
      const track = stream.getAudioTracks()[0];
      track.enabled = !this.snapshot.muted;
      const old = this.localRecorder;
      this.localRecorder = null;
      await old?.stop();
      this.micTrack = track;
      this.mic$.next(track);
      this.watchMic(track);
      this.meterSelf(track);
      this.update({ mic: this.snapshot.muted ? "muted" : "live" });
      if (this.snapshot.room?.status === "recording") await this.ensureLocalRecorder();
      this.reportStatus();
    } catch {
      // 画面が隠れている間は取れないことがある。表に戻ったときにもう一度試す
    } finally {
      this.reacquiring = false;
    }
  }

  private installPageHandlers() {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        // 裏に回る前に手元の録音を吐き出して送っておく
        this.localRecorder?.flush();
        for (const backup of this.backupRecorders.values()) backup.recorder.flush();
        this.uploader?.retryNow();
      } else {
        this.levels.resume();
        void this.acquireWakeLock();
        if (this.micTrack.readyState === "ended") void this.reacquireMic();
        else if (this.snapshot.room?.status === "recording") void this.ensureLocalRecorder();
        this.uploader?.retryNow();
      }
    };
    const onOnline = () => this.uploader?.retryNow();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (this.snapshot.room?.status === "recording" || (this.uploader?.pending ?? 0) > 0) {
        event.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);
    this.cleanupFns.push(() => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
    });
  }

  private async acquireWakeLock() {
    if (this.disposed || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try {
      this.wakeLock = await navigator.wakeLock.request("screen");
      this.update({ wakeLock: true });
      this.wakeLock.addEventListener("release", () => this.update({ wakeLock: false }));
    } catch {
      this.update({ wakeLock: false });
    }
  }

  private handleEnded(ended: EndReason) {
    this.update({ ended });
    if (ended === "kicked") {
      void this.stopAllRecorders();
      this.uploader?.stop();
    }
    if (ended === "closed") {
      void this.stopAllRecorders();
    }
  }
}
