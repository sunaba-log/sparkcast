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
  const [news] = useState(proposal.relatedNews);
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

      <section className="rounded-lg border border-blue-100 bg-blue-50/60 p-5">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">
            🧵 最近よく出てきたテーマ
          </h3>
          {topics.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">テーマはまだ生成されていません。</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-gray-700">
              {topics.map((topic, index) => (
                <li key={`${topic.title}-${index}`}>・{topic.title || "テーマ未生成"}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-gray-800">💡 会話のタネ</h3>
          {topics.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">会話のタネはまだ生成されていません。</p>
          ) : (
            <div className="mt-3 space-y-4">
              {topics.map((topic, index) => (
                <div key={index} className="rounded-md bg-white p-4 ring-1 ring-blue-100">
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600">テーマ</span>
                    <input
                      value={topic.title}
                      placeholder="仮タイトルを入力"
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
                    <span className="text-xs font-medium text-gray-600">話す観点</span>
                    <textarea
                      value={topic.suggestedPoints.join("\n")}
                      placeholder={
                        "最近の論点との接続:\n何が面白いか:\n次に話せそうな問い:"
                      }
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
                      rows={5}
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    />
                  </label>
                  {topic.relatedPastEpisodes.length > 0 ? (
                    <p className="mt-2 text-xs text-gray-500">
                      関連過去回:{" "}
                      {topic.relatedPastEpisodes.map((episodeId) => `#${episodeId}`).join(", ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-gray-800">関連URL</h3>
          {news.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">関連URLはまだ生成されていません。</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm text-gray-700">
              {news.map((item, index) => (
                <li key={`${item.url}-${index}`}>
                  ・{item.title || displayUrl(item.url)}{" "}
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-blue-700 hover:underline"
                    >
                      {displayUrl(item.url)}
                    </a>
                  ) : (
                    <span className="text-gray-500">URL未設定</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-5 text-xs font-medium text-gray-500">
          📊 {new Set(topics.flatMap((topic) => topic.relatedPastEpisodes)).size}{" "}
          関連エピソード / AI リサーチ
        </p>
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
