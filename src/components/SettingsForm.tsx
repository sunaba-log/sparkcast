"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Radio, Rss } from "lucide-react";

export function SettingsForm({
  podcastId,
  title: initialTitle,
  description: initialDescription,
  rssFeedPath: initialRssFeedPath,
}: {
  podcastId: number;
  title: string;
  description: string;
  rssFeedPath: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [rssFeedPath, setRssFeedPath] = useState(initialRssFeedPath);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    try {
      setSaving(true);
      setSaved(false);
      setError("");
      const response = await fetch(`/api/podcasts/${podcastId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          rssFeedPath: rssFeedPath.trim(),
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "設定の保存に失敗しました");
      }
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "設定の保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center text-xs text-gray-500 gap-2">
        <span>ホーム</span>
        <span>&gt;</span>
        <span className="font-medium text-gray-800">番組設定</span>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="rounded-xs border border-brand/30 p-6 space-y-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Radio className="w-5 h-5 text-brand" />
            番組基本設定
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            選択中チャンネルのメタデータ設定です。
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-5 border-t border-gray-100 pt-5">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              番組名
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setSaved(false);
              }}
              required
              maxLength={255}
              className="w-full px-3.5 py-2.5 rounded-xs border border-brand text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              番組概要
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setSaved(false);
              }}
              maxLength={2000}
              className="w-full px-3.5 py-2.5 rounded-xs border border-brand text-sm text-gray-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
              <Rss className="w-3.5 h-3.5 text-orange-500" /> RSS Feed URL
            </label>
            <input
              type="text"
              value={rssFeedPath}
              onChange={(e) => {
                setRssFeedPath(e.target.value);
                setSaved(false);
              }}
              maxLength={2000}
              className="w-full px-3.5 py-2 rounded-xs border border-brand text-xs font-mono text-gray-800 focus:outline-none focus:border-brand"
            />
          </div>

          <div className="pt-3 flex items-center justify-between border-t border-gray-100">
            <span className="text-xs text-emerald-600 font-semibold">
              {saved ? "設定を更新しました" : ""}
            </span>
            <button
              type="submit"
              disabled={saving || title.trim().length === 0}
              className="px-6 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-xs text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" /> {saving ? "保存中..." : "設定を保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
