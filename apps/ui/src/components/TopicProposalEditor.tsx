"use client";

import { useState, useRef, useEffect } from "react";
import type { TopicProposal } from "@/types/episode";
import { ChevronUp, ChevronDown, Plus, X, ArrowLeft, ArrowRight } from "lucide-react";

export function TopicProposalEditor({
  proposals,
  initialProposalId,
  initialTopicIndex,
}: {
  proposals: TopicProposal[];
  /** ディープリンク（/agenda?proposal=...）で初期選択する提案 ID。 */
  initialProposalId?: string;
  /** ディープリンク（&topic=N）でスクロール表示する議題のインデックス。 */
  initialTopicIndex?: number;
}) {
  // Sort proposals by generatedAt in ascending chronological order
  const sortedProposals = [...proposals].sort((a, b) => {
    return new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime();
  });

  // Select the deep-linked proposal if present, otherwise the latest one
  const latestProposal = sortedProposals[sortedProposals.length - 1];
  const [selectedProposalId, setSelectedProposalId] = useState<string>(() => {
    if (
      initialProposalId &&
      sortedProposals.some((p) => p.id === initialProposalId)
    ) {
      return initialProposalId;
    }
    return latestProposal?.id || "";
  });

  // クライアント遷移（チャットのリンク等）では再マウントされないため、
  // ディープリンク先の変化に合わせてレンダー中に選択を調整する。
  const [prevInitialProposalId, setPrevInitialProposalId] =
    useState(initialProposalId);
  if (initialProposalId !== prevInitialProposalId) {
    setPrevInitialProposalId(initialProposalId);
    if (
      initialProposalId &&
      sortedProposals.some((p) => p.id === initialProposalId)
    ) {
      setSelectedProposalId(initialProposalId);
    }
  }

  const selectedProposal = sortedProposals.find((p) => p.id === selectedProposalId) || latestProposal;

  if (!selectedProposal) {
    return (
      <div className="text-center py-8 text-gray-500">
        提案されたトピックはありません。
      </div>
    );
  }

  const currentIndex = sortedProposals.findIndex((p) => p.id === selectedProposal.id);

  const handlePrev = () => {
    if (currentIndex > 0) {
      setSelectedProposalId(sortedProposals[currentIndex - 1].id);
    }
  };

  const handleNext = () => {
    if (currentIndex < sortedProposals.length - 1) {
      setSelectedProposalId(sortedProposals[currentIndex + 1].id);
    }
  };

  const getOnlyDate = (dateTimeStr: string) => {
    return dateTimeStr.split(" ")[0].split("T")[0];
  };

  // Calculate pagination pages with ellipses
  const pages: (number | string)[] = [];
  const N = sortedProposals.length;
  if (N > 0) {
    const corePages = new Set<number>();
    corePages.add(0);
    corePages.add(N - 1);
    corePages.add(currentIndex);
    if (currentIndex - 1 >= 0) corePages.add(currentIndex - 1);
    if (currentIndex + 1 < N) corePages.add(currentIndex + 1);

    const sortedPages = Array.from(corePages).sort((a, b) => a - b);
    for (let idx = 0; idx < sortedPages.length; idx++) {
      const curr = sortedPages[idx];
      if (idx > 0) {
        const prev = sortedPages[idx - 1];
        if (curr - prev === 2) {
          pages.push(prev + 1);
        } else if (curr - prev > 2) {
          pages.push(`ellipsis-${prev}-${curr}`);
        }
      }
      pages.push(curr);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4">
        <h1 className="text-sm font-bold text-gray-900">次回議題</h1>

        {/* Date Switcher Bar */}
        <div className="flex items-center flex-wrap gap-2 text-xs justify-center">
          <button
            onClick={handlePrev}
            disabled={currentIndex <= 0}
            className="flex items-center justify-center gap-1 rounded-none px-4 py-2 text-xs font-medium text-gray-500 transition-colors hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Previous
          </button>

          {pages.map((item) => {
            if (typeof item === "string") {
              return (
                <span key={item} className="px-1.5 py-1 text-gray-400 select-none shrink-0">
                  ...
                </span>
              );
            }
            const p = sortedProposals[item];
            const isSelected = p.id === selectedProposal.id;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedProposalId(p.id)}
                className={`rounded-none px-4 py-2 text-xs transition-colors shrink-0 ${isSelected
                  ? "bg-brand text-white font-medium"
                  : "border border-brand/30 text-gray-700 hover:bg-gray-50"
                  }`}
              >
                {getOnlyDate(p.generatedAt)}
              </button>
            );
          })}

          <button
            onClick={handleNext}
            disabled={currentIndex >= sortedProposals.length - 1}
            className="flex items-center justify-center gap-1 rounded-none px-4 py-2 text-xs font-medium text-gray-500 transition-colors hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            Next <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Accordion Topics List keyed by selectedProposal.id to reset state on change */}
      <TopicProposalInnerEditor
        key={selectedProposal.id}
        proposal={selectedProposal}
        focusTopicIndex={initialTopicIndex}
      />
    </div>
  );
}

function TopicProposalInnerEditor({
  proposal,
  focusTopicIndex,
}: {
  proposal: TopicProposal;
  /** ディープリンクでスクロール表示する議題のインデックス。 */
  focusTopicIndex?: number;
}) {
  const [topics, setTopics] = useState(proposal.suggestedTopics);
  // 全議題を展開した状態で表示する（個別に閉じられる）。
  const [expandedIndexes, setExpandedIndexes] = useState<Set<number>>(
    () => new Set(proposal.suggestedTopics.map((_, index) => index)),
  );
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [editingPoint, setEditingPoint] = useState<{ topicIdx: number; ptIdx: number } | null>(null);
  const topicRefs = useRef<Array<HTMLDivElement | null>>([]);

  // クライアント遷移で focusTopicIndex が変わったとき、閉じられていれば展開し直す
  //（レンダー中の prop 変化調整パターン）。
  const [prevFocusTopicIndex, setPrevFocusTopicIndex] = useState(focusTopicIndex);
  if (focusTopicIndex !== prevFocusTopicIndex) {
    setPrevFocusTopicIndex(focusTopicIndex);
    if (focusTopicIndex !== undefined && !expandedIndexes.has(focusTopicIndex)) {
      const next = new Set(expandedIndexes);
      next.add(focusTopicIndex);
      setExpandedIndexes(next);
    }
  }

  // ディープリンク先の議題をスクロール表示する（クライアント遷移にも追従）。
  useEffect(() => {
    if (focusTopicIndex === undefined) return;
    topicRefs.current[focusTopicIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [focusTopicIndex]);

  async function handleSave() {
    try {
      setStatus("saving");
      setErrorMsg("");
      const response = await fetch(`/api/topic-proposals/${proposal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relatedNews: proposal.relatedNews,
          suggestedTopics: topics,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "保存に失敗しました");
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } catch (caught) {
      setStatus("error");
      setErrorMsg(caught instanceof Error ? caught.message : "保存に失敗しました");
    }
  }

  const toggleAccordion = (index: number) => {
    setExpandedIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleAddPoint = (topicIndex: number) => {
    setTopics((prev) =>
      prev.map((t, i) =>
        i === topicIndex
          ? { ...t, suggestedPoints: [...t.suggestedPoints, "新しい提案ポイント"] }
          : t
      )
    );
  };

  const handleRemoveEpisodeTag = (topicIndex: number, episodeId: number) => {
    setTopics((prev) =>
      prev.map((t, i) =>
        i === topicIndex
          ? {
            ...t,
            relatedPastEpisodes: t.relatedPastEpisodes.filter((id) => id !== episodeId),
          }
          : t
      )
    );
  };

  return (
    <div className="space-y-4">
      {topics.map((topic, index) => {
        const isExpanded = expandedIndexes.has(index);
        const relatedNewsItem = proposal.relatedNews[index] || proposal.relatedNews[0];

        return (
          <div
            key={index}
            ref={(el) => {
              topicRefs.current[index] = el;
            }}
            className="border border-brand/30 rounded-xs overflow-hidden transition-all duration-200"
          >
            {/* Header Bar / Collapsed view */}
            <div
              onClick={() => toggleAccordion(index)}
              className="p-4 sm:p-5 flex items-start justify-between cursor-pointer gap-2"
            >
              <div className="space-y-1 pr-2 sm:pr-4 flex-1">
                <h2 className="text-base font-bold text-gray-900 leading-snug">
                  {topic.title || "Google Cloud、Cloud SQLの次世代アーキテクチャを発表"}
                </h2>
                <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                  {topic.description ||
                    "パフォーマンスが大幅に向上し、NoSQLライクな柔軟なインデックス機能が追加パフォーマンスが大幅に向上し、NoSQLライクな柔軟なインデックス機能が追加。"}
                </p>
                {relatedNewsItem?.url && (
                  <div className="text-[11px] text-gray-400 pt-1">
                    出典:{" "}
                    <a
                      href={relatedNewsItem.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-brand hover:underline break-all"
                    >
                      {relatedNewsItem.url}
                    </a>
                  </div>
                )}
              </div>
              <button
                type="button"
                aria-label={isExpanded ? "トピックを閉じる" : "トピックを開く"}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center p-2 text-gray-500 hover:text-gray-800 shrink-0"
              >
                {isExpanded ? (
                  <ChevronUp className="w-5 h-5 text-brand" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-brand" />
                )}
              </button>
            </div>

            {/* Expanded Content View (Form Fields) */}
            {isExpanded && (
              <div className="px-4 sm:px-5 pb-5 pt-3 border-t border-gray-100 space-y-4">
                {/* Field: トピックの提案 */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    トピックの提案
                  </label>
                  <textarea
                    rows={2}
                    value={topic.title}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTopics((prev) =>
                        prev.map((t, i) => (i === index ? { ...t, title: val } : t))
                      );
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xs border border-brand text-base md:text-sm text-gray-900 focus:outline-none focus:border-brand"
                  />
                </div>

                {/* Field: 説明 */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    説明
                  </label>
                  <textarea
                    rows={3}
                    value={topic.description}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTopics((prev) =>
                        prev.map((t, i) => (i === index ? { ...t, description: val } : t))
                      );
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xs border border-brand text-base md:text-sm text-gray-900 leading-relaxed focus:outline-none focus:border-brand"
                  />
                </div>

                {/* Field: 提案ポイント */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    提案ポイント
                  </label>
                  <div className="space-y-2 mb-2">
                    {topic.suggestedPoints.map((point, ptIdx) => {
                      const isEditing =
                        editingPoint?.topicIdx === index && editingPoint?.ptIdx === ptIdx;

                      if (isEditing) {
                        return (
                          <input
                            key={ptIdx}
                            type="text"
                            value={point}
                            autoFocus
                            onBlur={() => setEditingPoint(null)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.currentTarget.blur();
                              }
                            }}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTopics((prev) =>
                                prev.map((t, i) =>
                                  i === index
                                    ? {
                                      ...t,
                                      suggestedPoints: t.suggestedPoints.map((p, pI) =>
                                        pI === ptIdx ? val : p
                                      ),
                                    }
                                    : t
                                )
                              );
                            }}
                            className="w-full min-h-[44px] px-3.5 py-2 rounded-xs border border-brand text-base md:text-sm text-gray-900 focus:outline-hidden focus:ring-1 focus:ring-brand"
                          />
                        );
                      }

                      return (
                        <div
                          key={ptIdx}
                          onClick={() => setEditingPoint({ topicIdx: index, ptIdx })}
                          className="group w-full min-h-[44px] px-3.5 py-2 rounded-xs border border-brand/50 text-sm text-gray-900 flex items-center overflow-hidden cursor-pointer hover:border-brand transition-colors"
                        >
                          <MarqueeText text={point} />
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddPoint(index)}
                    className="w-full min-h-[44px] py-2.5 bg-brand hover:bg-brand-hover text-white rounded-xs text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" /> 新規提案ポイントを追加
                  </button>
                </div>

                {/* Field: 過去の関連エピソード */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    過去の関連エピソード
                  </label>
                  <div className="flex flex-wrap items-center gap-2 p-3 border border-brand/30 rounded-xs">
                    {topic.relatedPastEpisodes.map((epId) => (
                      <span
                        key={epId}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-200 rounded text-xs font-mono font-medium text-gray-800"
                      >
                        {epId}
                        <button
                          type="button"
                          onClick={() => handleRemoveEpisodeTag(index, epId)}
                          aria-label={`エピソード ${epId} を削除`}
                          className="min-w-[28px] min-h-[28px] flex items-center justify-center text-gray-500 hover:text-gray-900"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Action Buttons Right Aligned */}
                <div className="pt-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-gray-200/60">
                  <div>
                    {status === "saved" && (
                      <span className="text-xs text-emerald-600 font-semibold">保存しました</span>
                    )}
                    {status === "error" && (
                      <span className="text-xs text-red-600 font-semibold">{errorMsg}</span>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                    <button
                      type="button"
                      onClick={() => toggleAccordion(index)}
                      className="px-4 py-2 rounded-none bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium text-xs transition-colors flex items-center justify-center"
                    >
                      破棄
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={status === "saving"}
                      className="px-4 py-2 rounded-none bg-brand hover:bg-brand-hover text-white font-medium text-xs transition-colors disabled:opacity-50 flex items-center justify-center"
                    >
                      {status === "saving" ? "保存中..." : "保存"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MarqueeText({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !textRef.current) return;

    const container = containerRef.current;
    const textEl = textRef.current;

    const checkOverflow = () => {
      const containerWidth = container.clientWidth;
      const textWidth = textEl.scrollWidth;
      if (containerWidth === 0) return;
      setShouldScroll(textWidth > containerWidth);
    };

    checkOverflow();

    const resizeObserver = new ResizeObserver(() => {
      checkOverflow();
    });
    resizeObserver.observe(container);
    resizeObserver.observe(textEl);

    return () => {
      resizeObserver.disconnect();
    };
  }, [text]);

  const duration = Math.max(6, Math.min(25, text.length * 0.25));

  return (
    <div ref={containerRef} className="w-full overflow-hidden whitespace-nowrap relative flex">
      <div
        className={`${shouldScroll ? "animate-marquee" : ""} whitespace-nowrap flex shrink-0`}
        style={shouldScroll ? { animationDuration: `${duration}s` } : undefined}
      >
        <span ref={textRef} className={shouldScroll ? "pr-12" : ""}>
          {text}
        </span>
        {shouldScroll && <span className="pr-12">{text}</span>}
      </div>
    </div>
  );
}
