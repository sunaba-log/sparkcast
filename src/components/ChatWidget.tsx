"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/types/chat";

const GREETING =
  "配信済みエピソードの議事録について質問できます。気になるテーマや過去回の内容を聞いてみてください。";

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState("");
  const [reindexState, setReindexState] = useState<
    "idle" | "running" | "done" | "error"
  >("idle");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, isOpen]);

  async function send() {
    const text = input.trim();
    if (!text || isStreaming) return;

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setError("");
    setIsStreaming(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!response.ok || !response.body) {
        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(result.error ?? "応答の生成に失敗しました");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistant = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        assistant += decoder.decode(value, { stream: true });
        setMessages((current) => {
          const updated = [...current];
          updated[updated.length - 1] = {
            role: "assistant",
            content: assistant,
          };
          return updated;
        });
      }
      if (!assistant) {
        throw new Error("応答が空でした");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "応答の生成に失敗しました");
      setMessages((current) => current.filter((m) => m.content !== ""));
    } finally {
      setIsStreaming(false);
    }
  }

  async function reindex() {
    if (reindexState === "running") return;
    setReindexState("running");
    setError("");
    try {
      const response = await fetch("/api/chat/reindex", { method: "POST" });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(result.error ?? "インデックス作成に失敗しました");
      }
      setReindexState("done");
    } catch (caught) {
      setReindexState("error");
      setError(
        caught instanceof Error ? caught.message : "インデックス作成に失敗しました",
      );
    }
  }

  return (
    <>
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[32rem] w-[22rem] max-w-[calc(100vw-3rem)] flex-col rounded-lg border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">議事録チャット</h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void reindex()}
                disabled={reindexState === "running"}
                aria-label="議事録インデックスを更新"
                title="議事録インデックスを更新"
                className="text-xs text-gray-500 hover:text-blue-600 disabled:opacity-50"
              >
                {reindexState === "running"
                  ? "更新中…"
                  : reindexState === "done"
                    ? "更新済み"
                    : "再インデックス"}
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="チャットを閉じる"
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <p className="text-sm leading-relaxed text-gray-500">{GREETING}</p>
            ) : (
              messages.map((message, index) => (
                <div
                  key={index}
                  className={
                    message.role === "user" ? "flex justify-end" : "flex justify-start"
                  }
                >
                  <div
                    className={
                      message.role === "user"
                        ? "max-w-[85%] whitespace-pre-wrap rounded-lg bg-blue-600 px-3 py-2 text-sm text-white"
                        : "max-w-[85%] whitespace-pre-wrap rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-800"
                    }
                  >
                    {message.content ||
                      (isStreaming && message.role === "assistant" ? "…" : "")}
                  </div>
                </div>
              ))
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>

          <div className="border-t border-gray-200 p-3">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="議事録について質問する…"
              className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => void send()}
                disabled={isStreaming || !input.trim()}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isStreaming ? "送信中…" : "送信"}
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={isOpen ? "チャットを閉じる" : "チャットを開く"}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-colors hover:bg-blue-700"
      >
        {isOpen ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        )}
      </button>
    </>
  );
}
