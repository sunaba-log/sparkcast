"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ChatMessage,
  ChatSessionDetail,
  ChatSessionSummary,
} from "@/types/chat";

const GREETING =
  "配信済みエピソードの議事録について質問できます。気になるテーマや過去回の内容を聞いてみてください。";

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState("");
  const [reindexState, setReindexState] = useState<
    "idle" | "running" | "done" | "error"
  >("idle");
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    try {
      const response = await fetch("/api/chat/sessions");
      if (!response.ok) return;
      const data = (await response.json()) as { sessions?: ChatSessionSummary[] };
      setSessions(data.sessions ?? []);
    } catch {
      // 一覧取得の失敗は致命的でないため握りつぶす
    }
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, view]);

  function toggleOpen() {
    const willOpen = !isOpen;
    setIsOpen(willOpen);
    if (willOpen) void loadSessions();
  }

  function startNewChat() {
    setActiveSessionId(null);
    setTitle("");
    setMessages([]);
    setInput("");
    setError("");
    setView("chat");
  }

  async function openSession(id: string) {
    setError("");
    try {
      const response = await fetch(`/api/chat/sessions/${id}`);
      if (!response.ok) throw new Error();
      const data = (await response.json()) as ChatSessionDetail;
      setActiveSessionId(data.id);
      setTitle(data.title);
      setMessages(data.messages);
      setView("chat");
    } catch {
      setError("チャットの読み込みに失敗しました");
    }
  }

  async function removeSession(id: string) {
    setSessions((current) => current.filter((session) => session.id !== id));
    if (id === activeSessionId) startNewChat();
    try {
      await fetch(`/api/chat/sessions/${id}`, { method: "DELETE" });
    } catch {
      // 削除失敗時は次回の一覧取得で復帰する
    }
  }

  function bumpSession(id: string) {
    const now = new Date().toISOString();
    setSessions((current) =>
      current
        .map((session) =>
          session.id === id ? { ...session, updatedAt: now } : session,
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }

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

    let sessionId = activeSessionId;
    try {
      // 新規チャットなら先にセッションを作成して履歴へ残す
      if (!sessionId) {
        const created = await createRemoteSession(nextMessages);
        sessionId = created.id;
        setActiveSessionId(created.id);
        setTitle(created.title);
        setSessions((current) => [created, ...current]);
      }

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
      if (!assistant) throw new Error("応答が空でした");

      const finalMessages: ChatMessage[] = [
        ...nextMessages,
        { role: "assistant", content: assistant },
      ];
      await persistSession(sessionId, finalMessages);
      bumpSession(sessionId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "応答の生成に失敗しました");
      setMessages((current) => current.filter((message) => message.content !== ""));
    } finally {
      setIsStreaming(false);
    }
  }

  async function createRemoteSession(
    initialMessages: ChatMessage[],
  ): Promise<ChatSessionSummary> {
    const response = await fetch("/api/chat/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: initialMessages }),
    });
    if (!response.ok) throw new Error("チャットの作成に失敗しました");
    return (await response.json()) as ChatSessionSummary;
  }

  async function persistSession(id: string, finalMessages: ChatMessage[]) {
    try {
      await fetch(`/api/chat/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: finalMessages }),
      });
    } catch {
      // 保存失敗は表示中の会話には影響しないため握りつぶす
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
          <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-3">
            {view === "chat" ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void loadSessions();
                    setView("history");
                  }}
                  aria-label="履歴を開く"
                  title="履歴"
                  className="text-gray-500 hover:text-blue-600"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </svg>
                </button>
                <h2 className="flex-1 truncate text-sm font-semibold text-gray-900">
                  {title || "新しいチャット"}
                </h2>
                <button
                  type="button"
                  onClick={startNewChat}
                  aria-label="新しいチャット"
                  title="新しいチャット"
                  className="text-gray-500 hover:text-blue-600"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </>
            ) : (
              <h2 className="flex-1 text-sm font-semibold text-gray-900">履歴</h2>
            )}
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="チャットを閉じる"
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          {view === "history" ? (
            <>
              <div className="flex-1 overflow-y-auto p-2">
                <button
                  type="button"
                  onClick={startNewChat}
                  className="mb-2 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600"
                >
                  ＋ 新しいチャット
                </button>
                {sessions.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-gray-400">
                    まだ履歴がありません
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {sessions.map((session) => (
                      <li
                        key={session.id}
                        className={`flex items-center gap-2 rounded-md px-2 py-2 hover:bg-gray-100 ${
                          session.id === activeSessionId ? "bg-blue-50" : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => void openSession(session.id)}
                          className="flex-1 truncate text-left text-sm text-gray-800"
                        >
                          {session.title}
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeSession(session.id)}
                          aria-label="このチャットを削除"
                          title="削除"
                          className="text-gray-300 hover:text-red-500"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="border-t border-gray-200 p-2">
                <button
                  type="button"
                  onClick={() => void reindex()}
                  disabled={reindexState === "running"}
                  className="w-full rounded-md px-3 py-1.5 text-xs text-gray-500 hover:text-blue-600 disabled:opacity-50"
                >
                  {reindexState === "running"
                    ? "議事録を更新中…"
                    : reindexState === "done"
                      ? "議事録を更新しました"
                      : "議事録インデックスを更新"}
                </button>
              </div>
            </>
          ) : (
            <>
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
                      {message.role === "user" ? (
                        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">
                          {message.content}
                        </div>
                      ) : (
                        <div className="max-w-[85%] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-800">
                          {message.content ? (
                            <div className="prose prose-sm prose-gray max-w-none break-words [&_:first-child]:mt-0 [&_:last-child]:mb-0 prose-pre:bg-gray-800 prose-pre:text-gray-100">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {message.content}
                              </ReactMarkdown>
                            </div>
                          ) : isStreaming ? (
                            "…"
                          ) : (
                            ""
                          )}
                        </div>
                      )}
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
                    // IME変換確定のEnterでは送信しない（日本語入力対策）。
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  rows={2}
                  placeholder="議事録について質問する…"
                  className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-gray-400">
                    Enterで送信 / Shift+Enterで改行
                  </span>
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
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={toggleOpen}
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
