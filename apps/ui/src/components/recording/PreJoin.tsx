"use client";

import { useEffect, useRef, useState } from "react";
import { Headphones, Mic, RotateCw, Wifi } from "lucide-react";
import { LevelMonitor } from "@/lib/recording/levels";
import { micConstraints } from "@/lib/recording/controller";
import { LevelBar } from "@/components/recording/LevelBar";
import { detectMicEnvironment, micHelpFor, type MicHelp } from "@/lib/recording/mic-help";

export type PreJoinResult = {
  displayName: string;
  track: MediaStreamTrack;
  deviceId: string | null;
  headphones: boolean;
};

const HEADPHONES_KEY = "sparkcast-recording:headphones";

function loadHeadphones(): boolean {
  try {
    return localStorage.getItem(HEADPHONES_KEY) === "1";
  } catch {
    return false;
  }
}

type NetworkCheck = { state: "checking" } | { state: "ok"; rttMs: number } | { state: "slow"; rttMs: number } | { state: "error" };

export function PreJoin({
  mode,
  initialName,
  realtimeBaseUrl,
  joining,
  error,
  onJoin,
}: {
  mode: "host" | "guest";
  initialName: string;
  realtimeBaseUrl: string;
  joining: boolean;
  error: string | null;
  onJoin: (result: PreJoinResult) => void;
}) {
  const [displayName, setDisplayName] = useState(initialName);
  const [consent, setConsent] = useState(mode === "host");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [micError, setMicError] = useState<MicHelp | null>(null);
  // 「もう一度試す」で増やし、マイクを取り直す
  const [micAttempt, setMicAttempt] = useState(0);
  // 前回の選択を引き継ぐ（描画後にしか読めないので、初めは使わない扱い）
  const [headphones, setHeadphones] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [network, setNetwork] = useState<NetworkCheck>({ state: "checking" });
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const monitorRef = useRef<LevelMonitor | null>(null);
  const handedOff = useRef(false);

  // マイクを取得（デバイスを切り替えたら取り直す）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setMicError({
            message: "このブラウザはマイクに対応していません。",
            steps: ["Chrome・Edge・Firefox・Safari の最新版で開き直す"],
          });
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { ...micConstraints(headphones), ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        trackRef.current?.stop();
        const track = stream.getAudioTracks()[0];
        trackRef.current = track;
        setActiveDeviceId(track.getSettings().deviceId ?? "");
        setMicError(null);
        if (!monitorRef.current) monitorRef.current = new LevelMonitor();
        monitorRef.current.set("self", track);
        const list = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
        if (!cancelled) setDevices(list);
      } catch (cause) {
        if (cancelled) return;
        const environment = detectMicEnvironment(navigator.userAgent, navigator.maxTouchPoints);
        setMicError(micHelpFor(cause, environment, { mac: /Macintosh/.test(navigator.userAgent) }));
      } finally {
        if (!cancelled) setRetrying(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId, micAttempt, headphones]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (loadHeadphones()) setHeadphones(true);
  }, []);

  function changeHeadphones(value: boolean) {
    setHeadphones(value);
    try {
      localStorage.setItem(HEADPHONES_KEY, value ? "1" : "0");
    } catch {
      // 保存できなくても、この入室では選んだとおりに使う
    }
  }

  useEffect(() => {
    const timer = setInterval(() => setLevel(monitorRef.current?.read().self ?? 0), 100);
    return () => {
      clearInterval(timer);
      monitorRef.current?.close();
      monitorRef.current = null;
      if (!handedOff.current) trackRef.current?.stop();
    };
  }, []);

  // 回線チェック（Worker までの往復時間）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const samples: number[] = [];
        for (let i = 0; i < 3; i += 1) {
          const started = performance.now();
          const response = await fetch(`${realtimeBaseUrl}/health`, { cache: "no-store" });
          if (!response.ok) throw new Error(String(response.status));
          samples.push(performance.now() - started);
        }
        const rttMs = Math.round(Math.min(...samples));
        if (!cancelled) setNetwork({ state: rttMs < 400 ? "ok" : "slow", rttMs });
      } catch {
        if (!cancelled) setNetwork({ state: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [realtimeBaseUrl]);

  const nameValid = displayName.trim().length > 0 && displayName.trim().length <= 30;
  const canJoin = !joining && activeDeviceId !== null && !micError && nameValid && consent && network.state !== "error";

  function join() {
    const track = trackRef.current;
    if (!track) return;
    handedOff.current = true;
    onJoin({ displayName: displayName.trim(), track, deviceId, headphones });
  }

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div className="space-y-1">
        <label htmlFor="display-name" className="block text-sm font-medium text-gray-700">
          表示名
        </label>
        <input
          id="display-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={30}
          placeholder="例: さとう"
          autoComplete="nickname"
          className="w-full border border-gray-300 rounded-xs px-3 py-2 text-base bg-white focus:outline-none focus:border-brand"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="mic-select" className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <Mic className="w-4 h-4 text-brand" /> マイク
        </label>
        {micError ? (
          <div role="alert" className="rounded-xs border border-red-200 bg-red-50 p-3 space-y-2">
            <p className="text-sm font-medium text-red-700">{micError.message}</p>
            <ol className="list-decimal pl-5 space-y-1 text-sm text-gray-700">
              {micError.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <button
              type="button"
              disabled={retrying}
              onClick={() => {
                setRetrying(true);
                setMicAttempt((value) => value + 1);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-brand text-brand rounded-xs bg-white hover:bg-brand-light disabled:opacity-40"
            >
              <RotateCw className={`w-4 h-4 ${retrying ? "animate-spin" : ""}`} />
              もう一度試す
            </button>
          </div>
        ) : (
          <>
            <select
              id="mic-select"
              value={deviceId ?? activeDeviceId ?? ""}
              onChange={(event) => setDeviceId(event.target.value || null)}
              className="w-full border border-gray-300 rounded-xs px-3 py-2 text-base sm:text-sm bg-white focus:outline-none focus:border-brand"
            >
              {devices.length === 0 && <option value="">マイクを確認しています…</option>}
              {devices.map((device, index) => (
                <option key={device.deviceId || index} value={device.deviceId}>
                  {device.label || `マイク ${index + 1}`}
                </option>
              ))}
            </select>
            <LevelBar level={level} />
            <p className="text-xs text-gray-500">話しかけてメーターが動くか確かめてください。</p>
          </>
        )}
      </div>

      <div className="flex gap-2 rounded-xs border border-brand/20 bg-brand-light/60 p-3 text-sm text-gray-700">
        <Headphones className="w-5 h-5 text-brand shrink-0" />
        <div className="space-y-2">
          <p>
            ヘッドホン（イヤホン）の使用をおすすめします。スピーカーだと相手の声がマイクに入り、音質が落ちます。
            収録中は画面を閉じたり、他のアプリに切り替えたりしないでください。
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={headphones}
              onChange={(event) => changeHeadphones(event.target.checked)}
              className="mt-1 accent-brand"
            />
            <span>
              ヘッドホン（イヤホン）を使う
              <span className="block text-xs text-gray-500">
                {headphones
                  ? "エコー除去を切って、声をそのまま録ります。"
                  : "スピーカーで聞く前提で、相手の声がマイクに入らないようエコー除去をかけます（声が少しこもります）。"}
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <Wifi className="w-4 h-4 text-brand" />
        {network.state === "checking" && <span className="text-gray-500">回線を確認しています…</span>}
        {network.state === "ok" && <span className="text-green-700">回線は良好です（{network.rttMs}ms）</span>}
        {network.state === "slow" && (
          <span className="text-yellow-700">回線が遅めです（{network.rttMs}ms）。Wi-Fi の近くでの参加をおすすめします。</span>
        )}
        {network.state === "error" && <span className="text-red-600">収録サーバーに接続できません。回線を確認してください。</span>}
      </div>

      {mode === "guest" && (
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            className="mt-1 accent-brand"
          />
          <span>
            この会話が録音され、編集のうえポッドキャストのエピソードとして公開される場合があることに同意します。
          </span>
        </label>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={join}
        disabled={!canJoin}
        className="w-full py-3 text-sm font-bold bg-brand text-white rounded-xs hover:bg-brand-hover disabled:opacity-40"
      >
        {joining ? "入室しています…" : "入室する"}
      </button>
    </div>
  );
}
