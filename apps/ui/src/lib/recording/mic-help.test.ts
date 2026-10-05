import { describe, expect, it } from "vitest";
import { detectMicEnvironment, micHelpFor } from "@/lib/recording/mic-help";

const UA = {
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  ipadSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0",
};

describe("detectMicEnvironment", () => {
  it("tells browsers and devices apart", () => {
    expect(detectMicEnvironment(UA.iphoneChrome)).toBe("ios-chrome");
    expect(detectMicEnvironment(UA.iphoneSafari)).toBe("ios-safari");
    expect(detectMicEnvironment(UA.ipadSafari, 5)).toBe("ios-safari");
    expect(detectMicEnvironment(UA.ipadSafari, 0)).toBe("mac-safari");
    expect(detectMicEnvironment(UA.android)).toBe("android-chrome");
    expect(detectMicEnvironment(UA.macChrome)).toBe("desktop-chrome");
    expect(detectMicEnvironment(UA.windowsEdge)).toBe("desktop-chrome");
    expect(detectMicEnvironment(UA.firefox)).toBe("desktop-firefox");
  });
});

describe("micHelpFor", () => {
  it("tells iPhone Chrome users to turn on the microphone in the iPhone settings", () => {
    const help = micHelpFor(new DOMException("denied", "NotAllowedError"), "ios-chrome");
    expect(help.message).toBe("マイクの使用が許可されていません。");
    expect(help.steps[0]).toContain("「Chrome」");
    expect(help.steps.join()).not.toContain("アドレスバーの左");
  });

  it("points to the OS settings when the system blocks the browser", () => {
    const help = micHelpFor(new DOMException("Permission denied by system", "NotAllowedError"), "desktop-chrome", { mac: true });
    expect(help.message).toContain("パソコンの設定");
    expect(help.steps[0]).toContain("プライバシーとセキュリティ");
  });

  it("explains a microphone held by another app", () => {
    expect(micHelpFor(new DOMException("busy", "NotReadableError"), "desktop-chrome").message).toContain("ほかのアプリ");
    expect(micHelpFor(new DOMException("none", "NotFoundError"), "desktop-chrome").message).toBe("マイクが見つかりませんでした。");
  });
});
