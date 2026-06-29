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

  const isMockAuthEnabled =
    process.env.NEXT_PUBLIC_ENABLE_LOCAL_MOCK_AUTH === "true";

  async function mockLogin() {
    try {
      setLoading(true);
      setError("");
      const response = await fetch("/api/auth/mock-session", {
        method: "POST",
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "モックログインに失敗しました");
      }
      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "モックログインに失敗しました",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-8 max-w-md mx-auto">
      <h1 className="text-xl font-bold text-gray-900">管理画面へログイン</h1>
      <p className="mt-2 text-sm text-gray-500">
        Podcaster&apos;s DevLogのメンバー用画面です。
      </p>
      {error && (
        <p className="mt-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {isMockAuthEnabled && (
        <div className="mt-6 p-4 rounded-md bg-amber-50 border border-amber-200 text-center">
          <p className="text-xs font-semibold text-amber-800 mb-2">
            🛠️ ローカル開発モード有効
          </p>
          <button
            type="button"
            onClick={mockLogin}
            disabled={loading}
            className="w-full px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-md hover:bg-amber-700 disabled:opacity-50"
          >
            {loading ? "ログイン中..." : "開発用ワンクリックログイン"}
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={login}
        disabled={loading}
        className="mt-4 w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "ログイン中..." : "Googleでログイン"}
      </button>
    </div>
  );
}
