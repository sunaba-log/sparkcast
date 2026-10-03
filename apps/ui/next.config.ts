import type { NextConfig } from "next";

const firebaseAuthHelperDomain =
  process.env.FIREBASE_AUTH_HELPER_DOMAIN ??
  (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    ? `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`
    : undefined);

const nextConfig: NextConfig = {
  // Cloud Run 用コンテナで動かすため、self-contained な出力にする
  output: "standalone",
  async headers() {
    return [
      {
        // 収録ルーム（#166）でマイクを使う。自オリジン以外（埋め込み等）には許可しない
        source: "/:path*",
        headers: [{ key: "Permissions-Policy", value: "microphone=(self), camera=()" }],
      },
    ];
  },
  async rewrites() {
    if (!firebaseAuthHelperDomain) return [];
    return [
      {
        source: "/__/auth/:path*",
        destination: `https://${firebaseAuthHelperDomain}/__/auth/:path*`,
      },
    ];
  },
};

export default nextConfig;
