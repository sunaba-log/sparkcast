// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { LoginForm } from "@/components/LoginForm";

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockRouter = {
  push: mockPush,
  refresh: mockRefresh,
};
vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

const mockGetRedirectResult = vi.fn();
const mockSignInWithPopup = vi.fn();
const mockSignInWithRedirect = vi.fn();

vi.mock("firebase/auth", () => ({
  getRedirectResult: (...args: unknown[]) => mockGetRedirectResult(...args),
  signInWithPopup: (...args: unknown[]) => mockSignInWithPopup(...args),
  signInWithRedirect: (...args: unknown[]) => mockSignInWithRedirect(...args),
}));

const fakeAuth = { name: "fake-auth" };
const fakeProvider = { name: "fake-provider" };

vi.mock("@/lib/firebase-client", () => ({
  getFirebaseAuth: () => fakeAuth,
  getGoogleAuthProvider: () => fakeProvider,
}));

describe("LoginForm", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockGetRedirectResult.mockResolvedValue(null);
    mockSignInWithPopup.mockResolvedValue({
      user: {
        getIdToken: vi.fn().mockResolvedValue("mock-id-token"),
      },
    });
    mockSignInWithRedirect.mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ registered: true }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  describe("redirect login completion", () => {
    it("sessionStorage.getItem が例外を送出しても未処理拒否にならず、ログイン操作を継続できること", async () => {
      const getItemSpy = vi
        .spyOn(sessionStorage, "getItem")
        .mockImplementation(() => {
          throw new DOMException("The operation is insecure.", "SecurityError");
        });

      try {
        render(<LoginForm />);

        // getRedirectResult が呼ばれ、未処理拒否にならず完了すること
        await waitFor(() => {
          expect(mockGetRedirectResult).toHaveBeenCalledWith(fakeAuth);
        });

        // エラーが表示されず、ログインボタンが操作可能であること
        expect(screen.queryByText(/認証情報を取得できませんでした/)).toBeNull();
        const loginButton = screen.getByRole("button", {
          name: "Googleでログイン",
        });
        expect((loginButton as HTMLButtonElement).disabled).toBe(false);

        // 通常通りポップアップログインが操作できること
        fireEvent.click(loginButton);
        expect(mockSignInWithPopup).toHaveBeenCalledWith(fakeAuth, fakeProvider);
      } finally {
        getItemSpy.mockRestore();
      }
    });

    it("保留中リダイレクトで getRedirectResult() が null の場合に案内を表示すること", async () => {
      sessionStorage.setItem("sparkcast_auth_redirect_pending", "1");
      mockGetRedirectResult.mockResolvedValue(null);

      render(<LoginForm />);

      const errorMessage = await screen.findByText(
        "認証情報を取得できませんでした。ブラウザのセキュリティ設定（クロスサイト追跡の防止など）をご確認いただくか、ポップアップを許可して再度お試しください。",
      );
      expect(errorMessage).not.toBeNull();

      // 保留フラグは消費されてクリアされていること
      expect(sessionStorage.getItem("sparkcast_auth_redirect_pending")).toBeNull();

      // 案内表示後もログインボタンは再試行可能であること
      const loginButton = screen.getByRole("button", {
        name: "Googleでログイン",
      });
      expect((loginButton as HTMLButtonElement).disabled).toBe(false);
    });

    it("保留中フラグがない通常初期表示では getRedirectResult() が null でもエラー案内を表示しないこと", async () => {
      mockGetRedirectResult.mockResolvedValue(null);

      render(<LoginForm />);

      await waitFor(() => {
        expect(mockGetRedirectResult).toHaveBeenCalledWith(fakeAuth);
      });

      expect(screen.queryByText(/認証情報を取得できませんでした/)).toBeNull();
      expect(screen.queryByText(/ログインに失敗しました/)).toBeNull();
    });

    it("リダイレクト認証情報が取得できた場合はセッション作成APIを呼び出して遷移すること", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ registered: true }),
      });
      global.fetch = mockFetch;

      mockGetRedirectResult.mockResolvedValue({
        user: {
          getIdToken: vi.fn().mockResolvedValue("valid-token"),
        },
      });

      render(<LoginForm />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/auth/session",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ idToken: "valid-token" }),
          }),
        );
      });

      expect(mockPush).toHaveBeenCalledWith("/episodes");
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  describe("popup login and fallback", () => {
    it("ポップアップブロック時にリダイレクトフォールバックが行われ保留フラグが設定されること", async () => {
      mockSignInWithPopup.mockRejectedValue({ code: "auth/popup-blocked" });

      render(<LoginForm />);
      const loginButton = screen.getByRole("button", {
        name: "Googleでログイン",
      });
      fireEvent.click(loginButton);

      await waitFor(() => {
        expect(mockSignInWithRedirect).toHaveBeenCalledWith(
          fakeAuth,
          fakeProvider,
        );
      });

      expect(sessionStorage.getItem("sparkcast_auth_redirect_pending")).toBe("1");
      expect(screen.queryByText(/ログインに失敗しました/)).toBeNull();
    });

    it("operation-not-supported-in-this-environment の場合もリダイレクトフォールバックが行われること", async () => {
      mockSignInWithPopup.mockRejectedValue({
        code: "auth/operation-not-supported-in-this-environment",
      });

      render(<LoginForm />);
      const loginButton = screen.getByRole("button", {
        name: "Googleでログイン",
      });
      fireEvent.click(loginButton);

      await waitFor(() => {
        expect(mockSignInWithRedirect).toHaveBeenCalledWith(
          fakeAuth,
          fakeProvider,
        );
      });

      expect(sessionStorage.getItem("sparkcast_auth_redirect_pending")).toBe("1");
    });

    it("ポップアップブロック時に sessionStorage.setItem が例外を送出してもリダイレクトへ移行すること", async () => {
      const setItemSpy = vi
        .spyOn(sessionStorage, "setItem")
        .mockImplementation(() => {
          throw new DOMException("The operation is insecure.", "SecurityError");
        });
      try {
        mockSignInWithPopup.mockRejectedValue({ code: "auth/popup-blocked" });

        render(<LoginForm />);
        const loginButton = screen.getByRole("button", {
          name: "Googleでログイン",
        });
        fireEvent.click(loginButton);

        await waitFor(() => {
          expect(mockSignInWithRedirect).toHaveBeenCalledWith(
            fakeAuth,
            fakeProvider,
          );
        });

        expect(screen.queryByText(/ログインに失敗しました/)).toBeNull();
      } finally {
        setItemSpy.mockRestore();
      }
    });

    it("ポップアップを閉じた場合 (auth/popup-closed-by-user) は非エラー扱いとなりリダイレクトも行われないこと", async () => {
      mockSignInWithPopup.mockRejectedValue({
        code: "auth/popup-closed-by-user",
      });

      render(<LoginForm />);
      const loginButton = screen.getByRole("button", {
        name: "Googleでログイン",
      });
      fireEvent.click(loginButton);

      await waitFor(() => {
        expect((loginButton as HTMLButtonElement).disabled).toBe(false);
      });

      expect(mockSignInWithRedirect).not.toHaveBeenCalled();
      expect(screen.queryByText(/ログインに失敗しました/)).toBeNull();
      expect(sessionStorage.getItem("sparkcast_auth_redirect_pending")).toBeNull();
    });

    it("一般的なエラーの場合はエラーメッセージを表示すること", async () => {
      mockSignInWithPopup.mockRejectedValue(
        new Error("ポップアップ通信エラーが発生しました"),
      );

      render(<LoginForm />);
      const loginButton = screen.getByRole("button", {
        name: "Googleでログイン",
      });
      fireEvent.click(loginButton);

      const errorMessage = await screen.findByText(
        "ポップアップ通信エラーが発生しました",
      );
      expect(errorMessage).not.toBeNull();
      expect(mockSignInWithRedirect).not.toHaveBeenCalled();
    });
  });
});
