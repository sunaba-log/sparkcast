"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { DirectorIntervention, Episode, EpisodePromotion } from "@/types/episode";
import {
  AlertTriangle,
  Check,
  Globe,
  Lock,
  Minus,
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  Trash2,
  Radio,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { formatJstDate, jstParts } from "@/lib/datetime";
import { htmlToPlainText } from "@/lib/text";
import {
  DirectorInterventionMarkers,
  DirectorInterventionsPanel,
} from "@/components/DirectorInterventionsPanel";
import { PolicyFindingsPanel } from "@/components/PolicyFindingsPanel";

type TabType = "overview" | "minutes" | "transcript" | "promotions" | "director";

// 日本時間で固定して書式化する（サーバーとブラウザで同じ文字列にし、描画の食い違いを防ぐ）
function formatDate(dateStr: string) {
  const parts = jstParts(dateStr);
  if (!parts) return dateStr;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:00`;
}

type PodcastInfo = {
  id: number;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  rssFeedPath: string | null;
};

const EPISODE_STATUS_LABELS: Record<string, string> = {
  upload_pending: "アップロード待ち",
  uploaded: "処理待ち",
  processing: "処理中",
  auditing: "監査中",
  awaiting_approval: "承認待ち",
  awaiting_publish_confirmation: "公開確認待ち",
  editing: "編集・合成中",
  completed: "完了",
  failed: "失敗",
};

export function EpisodeMasterDetail({
  initialEpisodes,
  podcast,
  initialSelectedId,
}: {
  initialEpisodes: Episode[];
  podcast: PodcastInfo | null;
  /** ディープリンク（/?episode=...）で初期選択するエピソード ID。 */
  initialSelectedId?: string;
}) {
  const router = useRouter();
  const [episodes, setEpisodes] = useState<Episode[]>(initialEpisodes);
  const [selectedId, setSelectedId] = useState<string>(() => {
    if (
      initialSelectedId &&
      initialEpisodes.some((e) => e.id === initialSelectedId)
    ) {
      return initialSelectedId;
    }
    return initialEpisodes.length > 0 ? initialEpisodes[0].id : "";
  });

  // クライアント遷移（チャットのリンク等）では再マウントされないため、
  // ディープリンク先の変化に合わせてレンダー中に選択を調整する。
  const [prevInitialSelectedId, setPrevInitialSelectedId] =
    useState(initialSelectedId);
  if (initialSelectedId !== prevInitialSelectedId) {
    setPrevInitialSelectedId(initialSelectedId);
    if (
      initialSelectedId &&
      episodes.some((e) => e.id === initialSelectedId)
    ) {
      setSelectedId(initialSelectedId);
    }
  }

  // ディープリンクで選択したエピソードを一覧内にスクロール表示する。
  const listItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    if (!initialSelectedId) return;
    listItemRefs.current[initialSelectedId]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [initialSelectedId]);
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [minutesTab, setMinutesTab] = useState<"preview" | "edit">("preview");

  // Selected episode
  const selectedEpisode = episodes.find((e) => e.id === selectedId) || episodes[0];

  // Editable form state for selected episode
  const [title, setTitle] = useState<string>(selectedEpisode?.title ?? "");
  const [description, setDescription] = useState<string>(selectedEpisode?.description ?? "");
  const [minutes, setMinutes] = useState<string>(selectedEpisode?.minutes ?? "");
  const [posts, setPosts] = useState<EpisodePromotion[]>(selectedEpisode?.xPosts ?? []);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Publish / Action states
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [pendingInterventionsCount, setPendingInterventionsCount] = useState(0);
  const [isTogglingPublish, setIsTogglingPublish] = useState(false);
  const [isRetryingAudit, setIsRetryingAudit] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Reset the player UI state synchronously when the episode changes.
  // (React 推奨の「prop 変化に合わせた state 調整」パターン: レンダー中に前回値と比較)
  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  if (selectedId !== prevSelectedId) {
    setPrevSelectedId(selectedId);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setTitle(selectedEpisode?.title ?? "");
    setDescription(selectedEpisode?.description ?? "");
    setMinutes(selectedEpisode?.minutes ?? "");
    setPosts(selectedEpisode?.xPosts ?? []);
    setMinutesTab("preview");
    setStatus("idle");
    setErrorMsg("");
    setActionNotice(null);
  }

  // Reload the audio element (external system) when the source changes.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.load();
    }
  }, [selectedId]);

  const togglePlay = () => {
    if (!audioRef.current || !selectedEpisode?.audioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch((err) => {
        console.error("Audio play failed:", err);
      });
    }
  };

  const handleSkipBackward = () => {
    if (!audioRef.current) return;
    const newTime = Math.max(0, audioRef.current.currentTime - 15);
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSkipForward = () => {
    if (!audioRef.current || !duration) return;
    const newTime = Math.min(duration, audioRef.current.currentTime + 15);
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const seekTo = (seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    setCurrentTime(seconds);
    audioRef.current.play().then(() => setIsPlaying(true)).catch(() => undefined);
  };

  function formatTime(seconds: number): string {
    if (isNaN(seconds)) return "00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (h > 0) {
      parts.push(String(h).padStart(2, "0"));
    }
    parts.push(String(m).padStart(2, "0"));
    parts.push(String(s).padStart(2, "0"));
    return parts.join(":");
  }

  // When selected episode changes, sync form state
  const handleSelectEpisode = (ep: Episode) => {
    router.push(`/episodes?episode=${encodeURIComponent(ep.id)}`);
    setSelectedId(ep.id);
    setTitle(ep.title);
    setDescription(ep.description);
    setMinutes(ep.minutes);
    setPosts(ep.xPosts);
    setMinutesTab("preview");
    setStatus("idle");
    setErrorMsg("");
  };

  async function handleSave() {
    if (!selectedEpisode) return;
    try {
      setStatus("saving");
      setErrorMsg("");
      const response = await fetch(`/api/episodes/${selectedEpisode.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minutes,
          promotions: posts.map((post) => ({
            id: post.id,
            message: post.message,
          })),
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "保存に失敗しました");

      // Update local state
      setEpisodes((prev) =>
        prev.map((e) =>
          e.id === selectedEpisode.id
            ? {
              ...e,
              title,
              description,
              minutes,
              xPosts: posts,
            }
            : e
        )
      );
      setStatus("saved");
    } catch (caught) {
      setStatus("error");
      setErrorMsg(caught instanceof Error ? caught.message : "保存に失敗しました");
    }
  }

  async function performPublish(publish: boolean) {
    if (!selectedEpisode) return;
    try {
      setIsTogglingPublish(true);
      setActionNotice(null);
      const response = await fetch(`/api/episodes/${selectedEpisode.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublished: publish }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "更新に失敗しました");

      setEpisodes((prev) =>
        prev.map((e) =>
          e.id === selectedEpisode.id
            ? {
                ...e,
                isPublished: publish,
                publishedAt: publish ? new Date().toISOString() : null,
              }
            : e,
        ),
      );
      setActionNotice(
        publish
          ? "エピソードを公開しました（RSSフィードに配信されます）"
          : "エピソードを非公開にしました（RSSフィードから除外されます）",
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "更新に失敗しました");
    } finally {
      setIsTogglingPublish(false);
    }
  }

  async function handleTogglePublish() {
    if (!selectedEpisode) return;
    if (selectedEpisode.isPublished) {
      await performPublish(false);
      return;
    }

    try {
      setIsTogglingPublish(true);
      const res = await fetch(`/api/episodes/${selectedEpisode.id}/interventions`);
      if (res.ok) {
        const data = (await res.json()) as { interventions?: DirectorIntervention[] };
        const pendingCount = (data.interventions ?? []).filter((i) => i.status === "pending").length;
        if (pendingCount > 0) {
          setPendingInterventionsCount(pendingCount);
          setIsPublishModalOpen(true);
          setIsTogglingPublish(false);
          return;
        }
      }
    } catch (e) {
      console.warn("Failed to check director interventions before publishing:", e);
    }
    await performPublish(true);
  }

  async function handleRetryAudit() {
    if (!selectedEpisode) return;
    try {
      setIsRetryingAudit(true);
      setActionNotice(null);
      const res = await fetch(`/api/episodes/${selectedEpisode.id}/retry-audit`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "再開に失敗しました");

      setEpisodes((prev) =>
        prev.map((e) =>
          e.id === selectedEpisode.id
            ? { ...e, status: "auditing", processingError: null }
            : e,
        ),
      );
      setActionNotice("監査を再開しました。しばらくお待ちください。");
    } catch (err) {
      alert(err instanceof Error ? err.message : "再開に失敗しました");
    } finally {
      setIsRetryingAudit(false);
    }
  }

  async function handleDeleteEpisode() {
    if (!selectedEpisode) return;
    if (
      !window.confirm(
        `エピソード「${selectedEpisode.title}」を削除しますか？\n（公開中の場合はRSSフィードからも削除されます）`,
      )
    ) {
      return;
    }

    try {
      setIsDeleting(true);
      setActionNotice(null);
      const res = await fetch(`/api/episodes/${selectedEpisode.id}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "削除に失敗しました");

      const remaining = episodes.filter((e) => e.id !== selectedEpisode.id);
      setEpisodes(remaining);
      if (remaining.length > 0) {
        handleSelectEpisode(remaining[0]);
      } else {
        router.push("/episodes");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setIsDeleting(false);
    }
  }

  if (episodes.length === 0) {
    return (
      <div className="rounded-xs border border-gray-200 p-12 text-center text-gray-500">
        <p className="text-lg font-medium">まだエピソードがありません</p>
        <p className="mt-1 text-sm">右上ボタンから音声ファイルをアップロードして最初のエピソードを作成しましょう</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Breadcrumb / Header */}
      <div className="flex items-center text-xs text-gray-500 gap-2 shrink-0">
        <span>ホーム</span>
        <span>&gt;</span>
        <span className="font-medium text-gray-800">エピソード</span>
      </div>

      {/* Master-Detail Container */}
      <div className="flex-1 grid min-h-0 grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left Column: Master List (5 cols) */}
        <div className={`${initialSelectedId ? "hidden lg:flex" : "flex"} col-span-1 min-h-0 flex-col space-y-3 overflow-y-auto pr-1 lg:col-span-5`}>
          {episodes.map((ep) => {
            const isSelected = ep.id === selectedEpisode?.id;
            return (
              <div
                key={ep.id}
                ref={(el) => {
                  listItemRefs.current[ep.id] = el;
                }}
                onClick={() => handleSelectEpisode(ep)}
                className={`p-4 rounded-xs cursor-pointer transition-all duration-150 border relative ${isSelected
                  ? "border-2 border-brand"
                  : "border-brand hover:bg-gray-100"
                  }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-bold text-gray-900 text-sm leading-snug line-clamp-2">
                    {ep.title}
                  </h3>
                  <span
                    className={`shrink-0 text-[10px] font-semibold text-white px-2 py-0.5 ${ep.status === "failed" ? "bg-red-600" : "bg-brand"}`}
                  >
                    {EPISODE_STATUS_LABELS[ep.status] ?? ep.status}
                  </span>
                </div>

                <div className="flex items-center text-xs space-x-3 mb-2">
                  <span>収録日: {formatJstDate(ep.createdAt)}</span>
                </div>

                <p className="text-xs text-gray-600 line-clamp-2 mb-3 leading-relaxed">
                  概要: {htmlToPlainText(ep.description) || ep.minutes?.slice(0, 80) || "概要文がまだ設定されていません。"}
                </p>

                {/* できているものだけに印を付ける（以前は処理の結果によらず 3 つとも付いていた） */}
                <div className="flex items-center gap-4 text-[11px] text-gray-600 border-t border-brand/30 pt-2 font-medium">
                  {[
                    { label: "配信済み", done: ep.status === "completed" && ep.isPublished },
                    { label: "議事録", done: ep.minutesGenerated },
                    { label: "X投稿文", done: ep.xPostsGenerated },
                  ].map((item) => (
                    <span key={item.label} className={`flex items-center gap-1 ${item.done ? "" : "text-gray-400"}`}>
                      {item.done ? (
                        <Check className="w-3.5 h-3.5 text-gray-800 stroke-[3]" />
                      ) : (
                        <Minus className="w-3.5 h-3.5" aria-label="未作成" />
                      )}
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: Inspector Panel (7 cols) */}
        {selectedEpisode && (
          <div className={`${initialSelectedId ? "flex" : "hidden"} rounded-xs border-t border-brand/30 overflow-hidden flex-col lg:col-span-7 lg:flex lg:border-t-0 lg:border-l`}>
            <div className="lg:hidden border-b border-brand/30 px-4 py-2">
              <button
                type="button"
                onClick={() => router.push("/episodes")}
                className="min-h-11 px-2 text-sm font-medium text-brand hover:text-brand-hover"
              >
                ← エピソード一覧に戻る
              </button>
            </div>
            {/* Top Bar Tabs & Actions */}
            {/* 幅が狭いとき、タブの文字を縦に折らずにタブごと折り返す */}
            <div className="px-5 py-1 border-b border-brand flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 gap-x-6 overflow-x-auto no-scrollbar">
                <button
                  onClick={() => setActiveTab("overview")}
                  className={`py-1 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${activeTab === "overview"
                    ? "border-brand text-brand"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                    }`}
                >
                  概要
                </button>
                <button
                  onClick={() => setActiveTab("minutes")}
                  className={`py-1 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${activeTab === "minutes"
                    ? "border-brand text-brand"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                    }`}
                >
                  議事録
                </button>
                <button
                  onClick={() => setActiveTab("transcript")}
                  className={`py-1 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${activeTab === "transcript"
                    ? "border-brand text-brand"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                    }`}
                >
                  文字起こし
                </button>
                <button
                  onClick={() => setActiveTab("promotions")}
                  className={`py-1 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${activeTab === "promotions"
                    ? "border-brand text-brand"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                    }`}
                >
                  SNS投稿文
                </button>
                <button
                  onClick={() => setActiveTab("director")}
                  className={`py-1 text-sm font-semibold whitespace-nowrap transition-colors inline-flex items-center gap-1.5 cursor-pointer ${
                    activeTab === "director"
                      ? "rounded-xs bg-brand text-white px-2.5 shadow-xs"
                      : selectedEpisode.status === "awaiting_approval"
                        ? "border-b-2 border-amber-400 text-amber-800 hover:text-amber-900"
                        : "border-b-2 border-transparent text-gray-500 hover:text-gray-800"
                  }`}
                >
                  <span>AI監査</span>
                  {(selectedEpisode.status === "awaiting_approval" || activeTab === "director") && (
                    <AlertTriangle
                      className={`w-3.5 h-3.5 shrink-0 ${
                        activeTab === "director" ? "text-amber-300" : "text-amber-600"
                      }`}
                    />
                  )}
                </button>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                {selectedEpisode.status === "failed" && (
                  <button
                    type="button"
                    onClick={handleRetryAudit}
                    disabled={isRetryingAudit}
                    className="px-3 py-1 whitespace-nowrap bg-amber-600 hover:bg-amber-700 text-white rounded-xs text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${isRetryingAudit ? "animate-spin" : ""}`} />
                    {isRetryingAudit ? "再開中..." : "監査を再開"}
                  </button>
                )}

                {selectedEpisode.status === "completed" && (
                  <button
                    type="button"
                    onClick={handleTogglePublish}
                    disabled={isTogglingPublish}
                    className={`px-3 py-1 whitespace-nowrap rounded-xs text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 ${
                      selectedEpisode.isPublished
                        ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                        : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                    }`}
                    title={selectedEpisode.isPublished ? "クリックして非公開にする" : "クリックしてRSSに公開する"}
                  >
                    {selectedEpisode.isPublished ? (
                      <>
                        <Globe className="w-3.5 h-3.5" />
                        公開中 (RSS配信)
                      </>
                    ) : (
                      <>
                        <Lock className="w-3.5 h-3.5" />
                        非公開 (下書き)
                      </>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleDeleteEpisode}
                  disabled={isDeleting}
                  className="px-3 py-1 whitespace-nowrap border border-gray-300 hover:bg-red-50 hover:text-red-600 hover:border-red-300 rounded-xs text-xs font-medium text-brand transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5 text-gray-500" />
                  {isDeleting ? "削除中..." : "削除"}
                </button>
              </div>
            </div>

            {actionNotice && (
              <div className="bg-emerald-50 border-b border-emerald-200 px-5 py-2 text-xs text-emerald-800 font-medium flex items-center justify-between">
                <span>{actionNotice}</span>
                <button
                  type="button"
                  onClick={() => setActionNotice(null)}
                  className="text-emerald-600 hover:text-emerald-800 ml-2 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="text-xs text-gray-500">
                更新日時 : {formatDate(selectedEpisode.createdAt)}
              </div>

              {/* Audio Player Preview */}
              <div className="rounded-xs p-4 border border-brand flex flex-col gap-4 backdrop-blur-xs sm:flex-row sm:items-center">
                {selectedEpisode.artworkUrl || podcast?.coverImageUrl ? (
                  <Image
                    src={selectedEpisode.artworkUrl || podcast?.coverImageUrl || ""}
                    alt={selectedEpisode.title}
                    width={96}
                    height={96}
                    sizes="(max-width: 640px) 56px, 96px"
                    priority
                    className="w-14 h-14 object-cover rounded-lg shrink-0 border border-brand/20 shadow-sm sm:w-24 sm:h-24"
                  />
                ) : (
                  <div className="w-14 h-14 bg-gradient-to-br from-brand/60 to-brand/20 rounded-lg shrink-0 flex flex-col items-center justify-center text-white/90 border border-brand/20 shadow-sm sm:w-24 sm:h-24">
                    <Radio className={`w-8 h-8 stroke-[1.5] mb-1 ${isPlaying ? "animate-pulse" : ""}`} />
                    <span className="text-[9px] font-bold tracking-wider uppercase opacity-80">
                      No Cover
                    </span>
                  </div>
                )}

                <div className="w-full flex-1 space-y-3">
                  <div className="flex items-center justify-center gap-6">
                    <button
                      onClick={handleSkipBackward}
                      disabled={!selectedEpisode.audioUrl}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:hover:text-gray-600 transition-colors cursor-pointer"
                      title="15秒戻る"
                    >
                      <SkipBack className="w-5 h-5 fill-current" />
                    </button>
                    <button
                      onClick={togglePlay}
                      disabled={!selectedEpisode.audioUrl}
                      className="w-11 h-11 rounded-full flex items-center justify-center shadow border border-gray-200 text-gray-800 disabled:opacity-40 hover:scale-105 active:scale-95 transition-transform bg-brand text-white cursor-pointer"
                      title={isPlaying ? "一時停止" : "再生"}
                    >
                      {isPlaying ? (
                        <Pause className="w-5 h-5 fill-current" />
                      ) : (
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      )}
                    </button>
                    <button
                      onClick={handleSkipForward}
                      disabled={!selectedEpisode.audioUrl}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:hover:text-gray-600 transition-colors cursor-pointer"
                      title="15秒進む"
                    >
                      <SkipForward className="w-5 h-5 fill-current" />
                    </button>
                  </div>

                  {/* Progress Bar & Time Display */}
                  <div className="space-y-1">
                    <div
                      onClick={handleProgressBarClick}
                      className={`w-full bg-gray-200 h-4 rounded-full overflow-hidden relative touch-none ${selectedEpisode.audioUrl ? "cursor-pointer" : "cursor-not-allowed"
                        }`}
                    >
                      <div
                        className="bg-brand h-full rounded-full transition-all duration-100 ease-out"
                        style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                      />
                      <DirectorInterventionMarkers
                        episodeId={selectedEpisode.id}
                        duration={duration}
                        onSeek={seekTo}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-gray-500 font-medium">
                      {selectedEpisode.audioUrl ? (
                        <>
                          <span>{formatTime(currentTime)}</span>
                          <span>{formatTime(duration)}</span>
                        </>
                      ) : (
                        <span className="text-gray-400 text-center w-full">
                          {selectedEpisode.status === "completed"
                            ? "音声ファイルが存在しません"
                            : "音声ファイル処理中..."}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <audio
                  ref={audioRef}
                  src={selectedEpisode.audioUrl || ""}
                  onTimeUpdate={() => {
                    if (audioRef.current) {
                      setCurrentTime(audioRef.current.currentTime);
                    }
                  }}
                  onDurationChange={() => {
                    if (audioRef.current) {
                      setDuration(audioRef.current.duration);
                    }
                  }}
                  onPause={() => setIsPlaying(false)}
                  onPlay={() => setIsPlaying(true)}
                  onEnded={() => {
                    setIsPlaying(false);
                    setCurrentTime(0);
                  }}
                />
              </div>

              {/* Tab Form Views */}
              {activeTab === "overview" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      タイトル
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xs border border-brand text-base md:text-sm text-gray-900 focus:outline-none focus:border-brand"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      概要文
                    </label>
                    <textarea
                      rows={6}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xs border border-brand text-base md:text-sm text-gray-900 leading-relaxed focus:outline-none focus:border-brand"
                    />
                  </div>
                </div>
              )}

              {activeTab === "minutes" && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-semibold text-gray-700">
                      議事録 / ショーノート
                    </label>
                    <div className="flex space-x-1 bg-gray-100 p-0.5 rounded-sm">
                      <button
                        type="button"
                        onClick={() => setMinutesTab("preview")}
                        className={`px-3 py-1 text-xs font-semibold rounded-xs transition-colors cursor-pointer ${minutesTab === "preview"
                          ? "bg-brand text-white shadow-xs"
                          : "text-gray-500 hover:text-gray-800"
                          }`}
                      >
                        プレビュー
                      </button>
                      <button
                        type="button"
                        onClick={() => setMinutesTab("edit")}
                        className={`px-3 py-1 text-xs font-semibold rounded-xs transition-colors cursor-pointer ${minutesTab === "edit"
                          ? "bg-brand text-white shadow-xs"
                          : "text-gray-500 hover:text-gray-800"
                          }`}
                      >
                        コード
                      </button>
                    </div>
                  </div>

                  {minutesTab === "preview" ? (
                    <div className="w-full min-h-[300px] overflow-y-auto px-4 py-3 rounded-xs border border-brand text-sm text-gray-800 shadow-inner markdown-preview">
                      {minutes ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents}
                        >
                          {minutes}
                        </ReactMarkdown>
                      ) : (
                        <p className="text-gray-400 italic">まだ議事録が生成されていません</p>
                      )}
                    </div>
                  ) : (
                    <textarea
                      rows={12}
                      value={minutes}
                      onChange={(e) => setMinutes(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xs border border-brand text-base md:text-sm text-gray-900 leading-relaxed focus:outline-none focus:border-brand"
                      placeholder="まだ議事録が生成されていません"
                    />
                  )}
                </div>
              )}

              {activeTab === "transcript" && (
                <TranscriptPanel
                  episodeId={selectedEpisode.id}
                  available={selectedEpisode.transcriptAvailable}
                  currentTime={currentTime}
                  canSeek={Boolean(selectedEpisode.audioUrl)}
                  onSeek={(seconds) => {
                    seekTo(seconds);
                  }}
                />
              )}

              {activeTab === "promotions" && (
                <div className="space-y-4">
                  <label className="block text-xs font-semibold text-gray-700">
                    X (Twitter) 投稿案
                  </label>
                  {posts.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4">まだ投稿案が生成されていません</p>
                  ) : (
                    posts.map((post, index) => (
                      <div key={post.id} className="p-3 border border-brand rounded-xs space-y-2">
                        <span className="text-xs font-semibold text-gray-500">候補 {index + 1}</span>
                        <textarea
                          rows={4}
                          value={post.message}
                          onChange={(e) => {
                            const newMsg = e.target.value;
                            setPosts((prev) =>
                              prev.map((item) =>
                                item.id === post.id ? { ...item, message: newMsg } : item
                              )
                            );
                          }}
                          className="w-full px-3 py-2 rounded-xs border border-brand/30 text-base md:text-sm text-gray-900 focus:outline-none"
                        />
                        <div className="text-right text-[11px] text-gray-400">
                          {post.message.length} 文字
                        </div>
                      </div>
                    ))
                  )}

                </div>
              )}

              {activeTab === "director" && (
                <>
                  <DirectorInterventionsPanel
                    key={selectedEpisode.id}
                    episodeId={selectedEpisode.id}
                    episodeStatus={selectedEpisode.status}
                    canSeek={Boolean(selectedEpisode.audioUrl)}
                    onSeek={seekTo}
                    onEditingStarted={() => {
                      setEpisodes((previous) =>
                        previous.map((episode) =>
                          episode.id === selectedEpisode.id
                            ? { ...episode, status: "editing" }
                            : episode,
                        ),
                      );
                    }}
                  />
                  <PolicyFindingsPanel
                    key={`${selectedEpisode.id}-policy`}
                    episodeId={selectedEpisode.id}
                    episodeStatus={selectedEpisode.status}
                    canSeek={Boolean(selectedEpisode.audioUrl)}
                    onSeek={seekTo}
                    onStatusChanged={(nextStatus) => {
                      setEpisodes((previous) =>
                        previous.map((episode) =>
                          episode.id === selectedEpisode.id
                            ? { ...episode, status: nextStatus }
                            : episode,
                        ),
                      );
                    }}
                  />
                </>
              )}
            </div>

            {/* Bottom Actions Bar */}
            <div className="p-4 border-t border-brand/30 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                {status === "saved" && (
                  <span className="text-xs text-emerald-600 font-semibold">保存しました</span>
                )}
                {status === "error" && (
                  <span className="text-xs text-red-600 font-semibold">{errorMsg}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setTitle(selectedEpisode.title);
                    setDescription(selectedEpisode.description);
                    setMinutes(selectedEpisode.minutes);
                    setPosts(selectedEpisode.xPosts);
                    setMinutesTab("preview");
                  }}
                  className="min-h-[44px] px-5 py-2.5 rounded-xs bg-gray-200/80 hover:bg-gray-300/80 text-gray-700 font-medium text-sm transition-colors flex items-center justify-center"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={status === "saving"}
                  className="min-h-[44px] px-6 py-2.5 rounded-xs bg-brand hover:bg-brand-hover text-white font-medium text-sm transition-colors disabled:opacity-50 flex items-center justify-center"
                >
                  {status === "saving" ? "保存中..." : "変更"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Jev Audit Warning Modal */}
      {isPublishModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-gray-900">
                未承認の監査結果があります
              </h3>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              AIディレクターによる事実確認・訂正提案に、未承認（保留中）の項目が{" "}
              <span className="font-bold text-amber-700">{pendingInterventionsCount} 件</span> あります。
              承認・却下を行わずにこのままポッドキャストを公開しますか？
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsPublishModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xs transition-colors cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={async () => {
                  setIsPublishModalOpen(false);
                  await performPublish(true);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-xs transition-colors cursor-pointer"
              >
                このまま公開する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-5 text-lg font-bold text-gray-900 border-b border-gray-200 pb-1">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-base font-bold text-gray-900">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-sm font-semibold text-gray-900">{children}</h3>
  ),
  p: ({ children }) => <p className="my-2.5 leading-relaxed text-gray-700">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-2.5 list-disc space-y-1.5 pl-6">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2.5 list-decimal space-y-1.5 pl-6">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-gray-900">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-4 border-gray-300 pl-4 text-gray-600 italic bg-gray-50 py-1 pr-2 rounded-r-sm">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[0.9em] font-mono text-pink-600">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-md bg-gray-900 p-4 text-xs text-gray-100 font-mono leading-relaxed">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-5 border-gray-200" />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand underline hover:text-brand-dark transition-colors"
    >
      {children}
    </a>
  ),
};
