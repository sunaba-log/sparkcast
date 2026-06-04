import Link from "next/link";
import { UploadForm } from "@/components/UploadForm";

export default function UploadPage() {
  return (
    <div>
      <div className="mb-6">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← エピソード一覧に戻る
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">エピソードをアップロード</h1>
        <p className="mt-1 text-sm text-gray-500">
          mp3ファイルをアップロードすると、RSS生成・Spotify・Apple Podcastsへの配信処理が開始されます（実装後）
        </p>
      </div>

      <UploadForm />
    </div>
  );
}
