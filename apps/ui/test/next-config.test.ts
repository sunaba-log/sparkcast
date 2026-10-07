import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("Next.js configuration", () => {
  it("enables AVIF and WebP image formats and remote patterns", () => {
    expect(nextConfig.images?.formats).toEqual(["image/avif", "image/webp"]);
    expect(nextConfig.images?.remotePatterns).toEqual([
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
    ]);
  });
});
