"use client";

import { useState, useRef } from "react";

export function UploadForm() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file && !file.name.endsWith(".mp3")) {
      alert("mp3ファイルを選択してください");
      e.target.value = "";
      return;
    }
    setSelectedFile(file);
    setStatus("idle");
  }

  function handleUpload() {
    if (!selectedFile) return;
    // TODO: Replace with actual upload logic (Cloud Storage + backend API)
    setStatus("success");
  }

  function handleReset() {
    setSelectedFile(null);
    setStatus("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-8 max-w-xl">
      <div
        className="border-2 border-dashed border-gray-300 rounded-lg p-10 text-center hover:border-blue-400 transition-colors cursor-pointer"
        onClick={() => inputRef.current?.click()}
      >
        <svg className="mx-auto w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
        <p className="mt-3 text-sm text-gray-600">クリックしてmp3ファイルを選択</p>
        <p className="mt-1 text-xs text-gray-400">MP3ファイルのみ対応</p>
        <input
          ref={inputRef}
          type="file"
          accept=".mp3,audio/mpeg"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {selectedFile && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-sm text-blue-800">
            <span className="font-medium">アップロード予定ファイル：</span>
            {selectedFile.name}
          </p>
          <p className="text-xs text-blue-600 mt-0.5">
            {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
          </p>
        </div>
      )}

      {status === "success" && (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
          <p className="text-sm text-green-800 font-medium">アップロードが完了しました</p>
          <p className="text-xs text-green-600 mt-0.5">
            バックグラウンドでRSS生成・配信処理が開始されます（実装後）
          </p>
        </div>
      )}

      <div className="mt-4 flex gap-3">
        <button
          onClick={handleUpload}
          disabled={!selectedFile || status === "success"}
          className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          アップロード開始
        </button>
        {(selectedFile || status !== "idle") && (
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            リセット
          </button>
        )}
      </div>
    </div>
  );
}
