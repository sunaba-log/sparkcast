"use client";

import { useState } from "react";
import type { TopicProposal } from "@/types/episode";

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
        <div className="space-y-4">
          {news.map((item, index) => (
            <div key={`${item.url}-${index}`} className="rounded-md bg-gray-50 p-4">
              <input
                value={item.title}
                onChange={(event) =>
                  setNews((current) =>
                    current.map((value, itemIndex) =>
                      itemIndex === index
                        ? { ...value, title: event.target.value }
                        : value,
                    ),
                  )
                }
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-medium"
              />
              <textarea
                value={item.summary}
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
                className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-blue-600 hover:underline"
              >
                元記事を開く
              </a>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-800 mb-3">会話の種</h3>
        <div className="space-y-4">
          {topics.map((topic, index) => (
            <div key={index} className="rounded-md bg-gray-50 p-4">
              <input
                value={topic.title}
                onChange={(event) =>
                  setTopics((current) =>
                    current.map((value, itemIndex) =>
                      itemIndex === index
                        ? { ...value, title: event.target.value }
                        : value,
                    ),
                  )
                }
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-medium"
              />
              <textarea
                value={topic.description}
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
                className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
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
