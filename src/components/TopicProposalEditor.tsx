"use client";

import { useState } from "react";
import type { TopicProposal } from "@/types/episode";

function displayUrl(url: string) {
  if (!url) return "URL未設定";
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function TopicProposalEditor({
  proposal,
}: {
  proposal: TopicProposal;
}) {
  const [news, setNews] = useState(proposal.relatedNews);
  const [topics, setTopics] = useState(proposal.suggestedTopics);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState("");

  async function save() {
    try {
      setStatus("saving");
      setError("");
      const response = await fetch(`/api/topic-proposals/${proposal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relatedNews: news,
          suggestedTopics: topics,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "保存に失敗しました");
      setStatus("saved");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "保存に失敗しました");
    }
  }

  return (
    <article className="bg-white border border-gray-200 rounded-lg p-6 space-y-6">
      <div>
        <h2 className="font-semibold text-gray-900">{proposal.targetPeriod}</h2>
        <p className="text-xs text-gray-400 mt-1">{proposal.generatedAt}</p>
      </div>

      <section>
        <h3 className="text-sm font-semibold text-gray-800 mb-3">関連ニュース</h3>
        {news.length === 0 ? (
          <p className="rounded-md bg-gray-50 p-4 text-sm text-gray-500">
            関連ニュースはまだ生成されていません。
          </p>
        ) : (
          <div className="space-y-4">
            {news.map((item, index) => (
              <div key={`${item.url}-${index}`} className="rounded-md bg-gray-50 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                    {displayUrl(item.url)}
                  </span>
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      元記事を開く
                    </a>
                  ) : null}
                </div>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">ニュースタイトル</span>
                  <input
                    value={item.title}
                    placeholder="タイトル未生成"
                    onChange={(event) =>
                      setNews((current) =>
                        current.map((value, itemIndex) =>
                          itemIndex === index
                            ? { ...value, title: event.target.value }
                            : value,
                        ),
                      )
                    }
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm font-medium"
                  />
                </label>
                <label className="mt-3 block">
                  <span className="text-xs font-medium text-gray-600">要約</span>
                  <textarea
                    value={item.summary}
                    placeholder="要約未生成"
                    onChange={(event) =>
                      setNews((current) =>
                        current.map((value, itemIndex) =>
                          itemIndex === index
                            ? { ...value, summary: event.target.value }
                            : value,
                        ),
                      )
                    }
                    rows={3}
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="mt-3 block">
                  <span className="text-xs font-medium text-gray-600">
                    このニュースを選んだ理由
                  </span>
                  <textarea
                    value={item.sourceReason}
                    placeholder="関連理由未生成"
                    onChange={(event) =>
                      setNews((current) =>
                        current.map((value, itemIndex) =>
                          itemIndex === index
                            ? { ...value, sourceReason: event.target.value }
                            : value,
                        ),
                      )
                    }
                    rows={2}
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-800 mb-3">会話の種</h3>
        {topics.length === 0 ? (
          <p className="rounded-md bg-gray-50 p-4 text-sm text-gray-500">
            会話の種はまだ生成されていません。
          </p>
        ) : (
          <div className="space-y-4">
            {topics.map((topic, index) => (
              <div key={index} className="rounded-md bg-gray-50 p-4">
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">テーマ</span>
                  <input
                    value={topic.title}
                    placeholder="テーマ未生成"
                    onChange={(event) =>
                      setTopics((current) =>
                        current.map((value, itemIndex) =>
                          itemIndex === index
                            ? { ...value, title: event.target.value }
                            : value,
                        ),
                      )
                    }
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm font-medium"
                  />
                </label>
                <label className="mt-3 block">
                  <span className="text-xs font-medium text-gray-600">概要</span>
                  <textarea
                    value={topic.description}
                    placeholder="概要未生成"
                    onChange={(event) =>
                      setTopics((current) =>
                        current.map((value, itemIndex) =>
                          itemIndex === index
                            ? { ...value, description: event.target.value }
                            : value,
                        ),
                      )
                    }
                    rows={3}
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="mt-3 block">
                  <span className="text-xs font-medium text-gray-600">
                    話す観点・根拠
                  </span>
                  <textarea
                    value={topic.suggestedPoints.join("\n")}
                    placeholder="1行ごとに話す観点を入力"
                    onChange={(event) =>
                      setTopics((current) =>
                        current.map((value, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...value,
                                suggestedPoints: event.target.value
                                  .split("\n")
                                  .map((line) => line.trim())
                                  .filter(Boolean),
                              }
                            : value,
                        ),
                      )
                    }
                    rows={4}
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <div className="mt-3">
                  <p className="text-xs font-medium text-gray-600">関連過去回</p>
                  {topic.relatedPastEpisodes.length === 0 ? (
                    <p className="mt-1 text-xs text-gray-500">関連過去回は未設定です。</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {topic.relatedPastEpisodes.map((episodeId) => (
                        <span
                          key={episodeId}
                          className="rounded-full bg-white px-2 py-1 text-xs text-gray-700 ring-1 ring-gray-200"
                        >
                          #{episodeId}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={status === "saving"}
          className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {status === "saving" ? "保存中..." : "アジェンダを保存"}
        </button>
        {status === "saved" && (
          <span className="text-sm text-green-700">保存しました</span>
        )}
        {status === "error" && (
          <span className="text-sm text-red-700">{error}</span>
        )}
      </div>
    </article>
  );
}
