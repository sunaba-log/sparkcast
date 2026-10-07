import { describe, expect, it } from "vitest";
import { metadata, viewport } from "@/app/layout";

describe("RootLayout metadata & viewport", () => {
  it("defines viewport with cover fit and theme color", () => {
    expect(viewport).toEqual({
      width: "device-width",
      initialScale: 1,
      maximumScale: 5,
      viewportFit: "cover",
      themeColor: "#F6F7EB",
    });
  });

  it("defines metadata with appleWebApp and manifest", () => {
    expect(metadata.title).toBe("SparkCast");
    expect(metadata.description).toBe("ポッドキャスト自動化管理ツール");
    expect(metadata.manifest).toBe("/manifest.json");
    expect(metadata.appleWebApp).toEqual({
      capable: true,
      statusBarStyle: "default",
      title: "SparkCast",
    });
  });
});
