"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Mic, Plus } from "lucide-react";
import type { RecordingSessionStatus } from "@/lib/recording/types";
import { RecordingStatusBadge } from "@/components/recording/RecordingStatusBadge";

type SessionSummary = {
  sessionId: string;
  title: string | null;
  status: RecordingSessionStatus;
  createdAt: string;
  episodeId: number | null;
};

export function RecordingSessionList({
  podcastId,
  sessions,
}: {
  podcastId: number;
  sessions: SessionSummary[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createRoom(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/recording/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ podcastId, title: title.trim() || undefined }),
      });
      const body = (await response.json()) as { sessionId?: string; error?: string };
      if (!response.ok || !body.sessionId) {
        setError(body.error ?? "収録ルームを作成できませんでした");
        setCreating(false);
        return;
      }
      router.push(`/record/${body.sessionId}`);
    } catch {
      setError("通信に失敗しました");
      setCreating(false);
    }
  }

  return (
    <div className="mt-6 space-y-8">
      <form onSubmit={createRoom} className="border border-brand/30 rounded-xs p-4 bg-white/60 space-y-3">
        <label className="block text-sm font-medium text-gray-700" htmlFor="recording-title">
          タイトル（任意）
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="recording-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={255}
            placeholder="例: 第12回 ゲスト回"
            className="flex-1 min-w-0 border border-gray-300 rounded-xs px-3 py-2 text-base sm:text-sm bg-white focus:outline-none focus:border-brand"
          />
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm bg-brand text-white rounded-xs hover:bg-brand-hover disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {creating ? "作成中…" : "収録ルームを作成"}
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <section>
        <h2 className="text-sm font-bold text-gray-700 mb-2">これまでの収録</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-gray-500">まだ収録ルームはありません。</p>
        ) : (
          <ul className="divide-y divide-brand/10 border border-brand/20 rounded-xs bg-white/60">
            {sessions.map((session) => (
              <li key={session.sessionId}>
                <Link
                  href={`/record/${session.sessionId}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-brand-subtle/30"
                >
                  <Mic className="w-4 h-4 text-brand shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-gray-900 truncate">
                      {session.title || "（タイトルなし）"}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {new Date(session.createdAt).toLocaleString("ja-JP")}
                    </span>
                  </span>
                  <RecordingStatusBadge status={session.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
