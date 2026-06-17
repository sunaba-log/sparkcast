"use client";

import { useRef, useState } from "react";

type UploadStatus = "idle" | "preparing" | "uploading" | "success" | "error";

type UploadPreparation = {
  episodeId: number;
  podcastId: number;
  objectPath: string;
  uploadUrl: string;
  expiresAt: string;
};

export function UploadForm() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [podcastId, setPodcastId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [uploadedEpisodeId, setUploadedEpisodeId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file && (file.type !== "audio/mpeg" || !file.name.toLowerCase().endsWith(".mp3"))) {
      setErrorMessage("MP3ファイルを選択してください");
      setStatus("error");
      e.target.value = "";
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    if (file && !title) {
      setTitle(file.name.replace(/\.mp3$/i, ""));
    }
    setStatus("idle");
    setErrorMessage("");
  }

  async function handleUpload() {
    if (!selectedFile) {
      setErrorMessage("MP3ファイルを選択してください");
      setStatus("error");
      return;
    }

    const parsedPodcastId = Number(podcastId);
    if (!Number.isInteger(parsedPodcastId) || parsedPodcastId <= 0) {
      setErrorMessage("Podcast IDには正の整数を入力してください");
      setStatus("error");
      return;
    }
    if (!title.trim()) {
      setErrorMessage("エピソードタイトルを入力してください");
      setStatus("error");
      return;
    }

    try {
      setErrorMessage("");
      setStatus("preparing");
      const response = await fetch("/api/episodes/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          podcastId: parsedPodcastId,
          title: title.trim(),
          description: description.trim() || undefined,
          fileName: selectedFile.name,
          contentType: "audio/mpeg",
          fileSize: selectedFile.size,
        }),
      });

      const preparation = (await response.json()) as UploadPreparation & { error?: string };
      if (!response.ok) {
        throw new Error(preparation.error || "アップロードの準備に失敗しました");
      }

      setStatus("uploading");
      const uploadResponse = await fetch(preparation.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "audio/mpeg" },
        body: selectedFile,
      });
      if (!uploadResponse.ok) {
        throw new Error("GCSへのアップロードに失敗しました");
      }

      setUploadedEpisodeId(preparation.episodeId);
      setStatus("success");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "アップロードに失敗しました");
      setStatus("error");
    }
  }

  function handleReset() {
    setSelectedFile(null);
    setPodcastId("");
    setTitle("");
    setDescription("");
    setStatus("idle");
    setErrorMessage("");
    setUploadedEpisodeId(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const isBusy = status === "preparing" || status === "uploading";

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-8 max-w-xl">
      <div className="space-y-4 mb-6">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Podcast ID</span>
          <input
            type="number"
            min="1"
            value={podcastId}
            onChange={(event) => setPodcastId(event.target.value)}
            disabled={isBusy}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
            placeholder="1"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">エピソードタイトル</span>
          <input
            type="text"
            maxLength={255}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={isBusy}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">説明（任意）</span>
          <textarea
            maxLength={10_000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={isBusy}
            rows={3}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
          />
        </label>
      </div>

      <div
        className="border-2 border-dashed border-gray-300 rounded-lg p-10 text-center hover:border-blue-400 transition-colors cursor-pointer"
        onClick={() => !isBusy && inputRef.current?.click()}
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
          disabled={isBusy}
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
            エピソードID: {uploadedEpisodeId}。バックグラウンド処理が開始されます。
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-800 font-medium">{errorMessage}</p>
        </div>
      )}

      {isBusy && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-sm text-blue-800 font-medium">
            {status === "preparing" ? "エピソードを作成しています..." : "MP3をアップロードしています..."}
          </p>
        </div>
      )}

      <div className="mt-4 flex gap-3">
        <button
          onClick={handleUpload}
          disabled={!selectedFile || status === "success" || isBusy}
          className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isBusy ? "処理中..." : "アップロード開始"}
        </button>
        {(selectedFile || status !== "idle") && (
          <button
            onClick={handleReset}
            disabled={isBusy}
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            リセット
          </button>
        )}
      </div>
    </div>
  );
}
