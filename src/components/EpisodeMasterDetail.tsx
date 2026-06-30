"use client";

import { useState } from "react";
import type { Episode, EpisodePromotion } from "@/types/episode";
import { Check, Play, Pause, SkipBack, SkipForward, Trash2 } from "lucide-react";

type TabType = "overview" | "minutes" | "promotions";

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${mins}:00`;
  } catch {
    return dateStr;
  }
}

export function EpisodeMasterDetail({ initialEpisodes }: { initialEpisodes: Episode[] }) {
  const [episodes, setEpisodes] = useState<Episode[]>(initialEpisodes);
  const [selectedId, setSelectedId] = useState<string>(
    initialEpisodes.length > 0 ? initialEpisodes[0].id : ""
  );
  const [activeTab, setActiveTab] = useState<TabType>("overview");

  // Selected episode
  const selectedEpisode = episodes.find((e) => e.id === selectedId) || episodes[0];

  // Editable form state for selected episode
  const [title, setTitle] = useState<string>(selectedEpisode?.title ?? "");
  const [description, setDescription] = useState<string>(selectedEpisode?.description ?? "");
  const [minutes, setMinutes] = useState<string>(selectedEpisode?.minutes ?? "");
  const [posts, setPosts] = useState<EpisodePromotion[]>(selectedEpisode?.xPosts ?? []);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Audio player mock state
  const [isPlaying, setIsPlaying] = useState(false);

  // When selected episode changes, sync form state
  const handleSelectEpisode = (ep: Episode) => {
    setSelectedId(ep.id);
    setTitle(ep.title);
    setDescription(ep.description);
    setMinutes(ep.minutes);
    setPosts(ep.xPosts);
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
      <div className="flex-1 grid grid-cols-12 gap-5 min-h-0">
        {/* Left Column: Master List (5 cols) */}
        <div className="col-span-5 flex flex-col space-y-3 overflow-y-auto pr-1">
          {episodes.map((ep) => {
            const isSelected = ep.id === selectedEpisode?.id;
            return (
              <div
                key={ep.id}
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
                  <span className="shrink-0 text-[10px] font-semibold bg-brand text-white px-2 py-0.5">
                    {ep.status === "completed" ? "完了" : ep.status}
                  </span>
                </div>

                <div className="flex items-center text-xs space-x-3 mb-2">
                  <span>再生時間: 45:12</span>
                  <span>収録日: {ep.createdAt.split("T")[0]}</span>
                </div>

                <p className="text-xs text-gray-600 line-clamp-2 mb-3 leading-relaxed">
                  概要: {ep.description || ep.minutes?.slice(0, 80) || "概要文がまだ設定されていません。"}
                </p>

                <div className="flex items-center gap-4 text-[11px] text-gray-600 border-t border-brand/30 pt-2 font-medium">
                  <span className="flex items-center gap-1">
                    <Check className="w-3.5 h-3.5 text-gray-800 stroke-[3]" /> 配信済み
                  </span>
                  <span className="flex items-center gap-1">
                    <Check className="w-3.5 h-3.5 text-gray-800 stroke-[3]" /> 議事録
                  </span>
                  <span className="flex items-center gap-1">
                    <Check className="w-3.5 h-3.5 text-gray-800 stroke-[3]" /> X投稿文
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: Inspector Panel (7 cols) */}
        {selectedEpisode && (
          <div className="col-span-7 rounded-xs border-l border-brand/30 flex flex-col overflow-hidden">
            {/* Top Bar Tabs & Actions */}
            <div className="px-5 py-1 border-b border-brand flex items-center justify-between">
              <div className="flex items-center space-x-6">
                <button
                  onClick={() => setActiveTab("overview")}
                  className={`py-1 text-sm font-semibold border-b-2 transition-colors ${activeTab === "overview"
                    ? "border-brand text-brand"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                    }`}
                >
                  概要
                </button>
                <button
                  onClick={() => setActiveTab("minutes")}
                  className={`py-1 text-sm font-semibold border-b-2 transition-colors ${activeTab === "minutes"
                    ? "border-brand text-brand"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                    }`}
                >
                  議事録
                </button>
                <button
                  onClick={() => setActiveTab("promotions")}
                  className={`py-1 text-sm font-semibold border-b-2 transition-colors ${activeTab === "promotions"
                    ? "border-brand text-brand"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                    }`}
                >
                  SNS投稿文
                </button>
              </div>

              <div className="flex items-center space-x-2">
                <span className="px-3 py-1 bg-emerald-600 text-white rounded-xs text-xs font-semibold">
                  配信済み
                </span>
                <button className="px-3 py-1 border border-gray-300 hover:bg-gray-50 rounded-xs text-xs font-medium text-brand transition-colors flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5 text-gray-500" />
                  削除
                </button>
              </div>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="text-xs text-gray-500">
                更新日時 : {formatDate(selectedEpisode.createdAt)}
              </div>

              {/* Audio Player Preview */}
              <div className="rounded-xs p-4 border border-brand flex items-center gap-4">
                <div className="w-24 h-24 bg-gray-300/80 rounded-lg shrink-0 flex items-center justify-center text-gray-400 font-bold text-xs">
                  artwork
                </div>
                <div className="flex-1 space-y-3">
                  <div className="flex items-center justify-center gap-6">
                    <button className="text-gray-600 hover:text-gray-900 transition-colors">
                      <SkipBack className="w-5 h-5 fill-current" />
                    </button>
                    <button
                      onClick={() => setIsPlaying(!isPlaying)}
                      className="w-10 h-10 rounded-full flex items-center justify-center shadow border border-gray-200 text-gray-800 hover:scale-105 transition-transform"
                    >
                      {isPlaying ? (
                        <Pause className="w-5 h-5 fill-current" />
                      ) : (
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      )}
                    </button>
                    <button className="text-gray-600 hover:text-gray-900 transition-colors">
                      <SkipForward className="w-5 h-5 fill-current" />
                    </button>
                  </div>
                  {/* Progress Bar */}
                  <div className="w-full bg-gray-300 h-2 rounded-full overflow-hidden relative">
                    <div className="bg-brand h-full w-1/3 rounded-full" />
                  </div>
                </div>
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
                      className="w-full px-3.5 py-2.5 rounded-xs border border-brand text-sm text-gray-900 focus:outline-none focus:border-brand"
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
                      className="w-full px-3.5 py-2.5 rounded-xs border border-brand text-sm text-gray-900 leading-relaxed focus:outline-none focus:border-brand"
                    />
                  </div>
                </div>
              )}

              {activeTab === "minutes" && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    議事録 / ショーノート
                  </label>
                  <textarea
                    rows={12}
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xs border border-brand text-sm text-gray-900 leading-relaxed focus:outline-none focus:border-brand"
                    placeholder="まだ議事録が生成されていません"
                  />
                </div>
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
                          className="w-full px-3 py-2 rounded-xs border border-brand/30 text-sm text-gray-900 focus:outline-none"
                        />
                        <div className="text-right text-[11px] text-gray-400">
                          {post.message.length} 文字
                        </div>
                      </div>
                    ))
                  )}
                </div>
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
                  }}
                  className="px-5 py-2 rounded-xs bg-gray-200/80 hover:bg-gray-300/80 text-gray-700 font-medium text-sm transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={status === "saving"}
                  className="px-6 py-2 rounded-xs bg-brand hover:bg-brand-hover text-white font-medium text-sm transition-colors disabled:opacity-50"
                >
                  {status === "saving" ? "保存中..." : "変更"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
