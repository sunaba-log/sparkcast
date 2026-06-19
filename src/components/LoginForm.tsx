"use client";

import { useState } from "react";
import { signInWithPopup } from "firebase/auth";
import { useRouter } from "next/navigation";
import {
  getFirebaseAuth,
  getGoogleAuthProvider,
} from "@/lib/firebase-client";

export function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function login() {
    try {
      setLoading(true);
      setError("");
      const credential = await signInWithPopup(
        getFirebaseAuth(),
        getGoogleAuthProvider(),
      );
      const idToken = await credential.user.getIdToken();
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "ログインに失敗しました");
      }
      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "ログインに失敗しました",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-8 max-w-md mx-auto">
      <h1 className="text-xl font-bold text-gray-900">dev環境へログイン</h1>
      <p className="mt-2 text-sm text-gray-500">
        Podcaster&apos;s DevLogの開発メンバー用画面です。
      </p>
      {error && (
        <p className="mt-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={login}
        disabled={loading}
        className="mt-6 w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "ログイン中..." : "Googleでログイン"}
      </button>
    </div>
  );
}
