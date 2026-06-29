"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  type UserCredential,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import {
  getFirebaseAuth,
  getGoogleAuthProvider,
} from "@/lib/firebase-client";

function shouldUseRedirectLogin() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent)
  );
}

function isPopupBlocked(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "auth/popup-blocked"
  );
}

export function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const createSession = useCallback(async (credential: UserCredential) => {
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
  }, [router]);

  useEffect(() => {
    let active = true;

    async function completeRedirectLogin() {
      try {
        setLoading(true);
        setError("");
        const credential = await getRedirectResult(getFirebaseAuth());
        if (!credential) return;
        await createSession(credential);
      } catch (caught) {
        if (!active) return;
        setError(
          caught instanceof Error ? caught.message : "ログインに失敗しました",
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    void completeRedirectLogin();
    return () => {
      active = false;
    };
  }, [createSession]);

  async function login() {
    try {
      setLoading(true);
      setError("");
      const auth = getFirebaseAuth();
      const provider = getGoogleAuthProvider();
      if (shouldUseRedirectLogin()) {
        await signInWithRedirect(auth, provider);
        return;
      }

      const credential = await signInWithPopup(auth, provider);
      await createSession(credential);
    } catch (caught) {
      if (isPopupBlocked(caught)) {
        await signInWithRedirect(getFirebaseAuth(), getGoogleAuthProvider());
        return;
      }
      setError(
        caught instanceof Error ? caught.message : "ログインに失敗しました",
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
