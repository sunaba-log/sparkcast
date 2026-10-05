import { describe, expect, it } from "vitest";
import { htmlToPlainText } from "@/lib/text";

describe("htmlToPlainText", () => {
  it("drops tags and keeps the words apart", () => {
    expect(htmlToPlainText("<p>【エピソード概要】</p><p>今回は&amp;ブラウザ収録</p>")).toBe("【エピソード概要】 今回は&ブラウザ収録");
  });

  it("keeps plain text as is", () => {
    expect(htmlToPlainText("ふつうの概要")).toBe("ふつうの概要");
  });
});
