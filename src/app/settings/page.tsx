"use client";

import { useState } from "react";
import { Save, Radio, Globe, Rss } from "lucide-react";

export default function SettingsPage() {
  const [showName, setShowName] = useState("sunabalog");
  const [description, setDescription] = useState(
    "技術・プロダクト開発・スタートアップの現場からお届けするポッドキャスト番組です。"
  );
  const [rssUrl, setRssUrl] = useState("https://sunaba-log.com/rss.xml");
  const [hostName, setHostName] = useState("Takayoshi Otaka");
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Breadcrumb Header */}
      <div className="flex items-center text-xs text-gray-500 gap-2">
        <span>ホーム</span>
        <span>&gt;</span>
        <span className="font-medium text-gray-800">番組設定</span>
      </div>

      <div className="rounded-xs border border-brand/30 p-6 space-y-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Radio className="w-5 h-5 text-brand" />
            番組基本設定 (Show Settings)
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            SparkCastで配信管理するポッドキャスト番組のメタデータ設定です。
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-5 border-t border-gray-100 pt-5">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              番組名 (Show Name)
            </label>
            <input
              type="text"
              value={showName}
              onChange={(e) => setShowName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xs border border-brand text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              番組概要 (Show Description)
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xs border border-brand text-sm text-gray-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
                <Rss className="w-3.5 h-3.5 text-orange-500" /> RSS Feed URL
              </label>
              <input
                type="text"
                value={rssUrl}
                onChange={(e) => setRssUrl(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xs border border-brand text-xs font-mono text-gray-800 focus:outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-brand" /> ホスト名 (Host Name)
              </label>
              <input
                type="text"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xs border border-brand text-sm text-gray-800 focus:outline-none focus:border-brand"
              />
            </div>
          </div>

          <div className="pt-3 flex items-center justify-between border-t border-gray-100">
            <div>
              {saved && (
                <span className="text-xs text-emerald-600 font-semibold">
                  設定を更新しました
                </span>
              )}
            </div>
            <button
              type="submit"
              className="px-6 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-xs text-sm font-medium transition-colors flex items-center gap-2"
            >
              <Save className="w-4 h-4" /> 設定を保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
