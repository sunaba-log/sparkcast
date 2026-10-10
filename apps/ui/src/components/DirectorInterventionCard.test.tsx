import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DirectorInterventionCard } from "@/components/DirectorInterventionCard";

describe("DirectorInterventionCard", () => {
  it("renders the audit details and editable correction script", () => {
    const html = renderToStaticMarkup(
      <DirectorInterventionCard
        intervention={{
          id: "intervention-1",
          insertAt: 754.5,
          sourceText: "この製品は2020年に発売されました。",
          speaker: "田中",
          severity: 4,
          category: "事実誤認",
          correctionScript: "正しくは2021年発売です。",
          status: "pending",
        }}
        disabled={false}
        canSeek
        onChange={() => undefined}
        onSeek={() => undefined}
      />,
    );

    expect(html).toContain("12:34.500");
    expect(html).toContain("深刻度 4/5");
    expect(html).toContain("事実誤認");
    expect(html).toContain("田中の発話");
    expect(html).toContain("正しくは2021年発売です。");
    expect(html).toContain("承認");
    expect(html).toContain("スキップ / 却下");
  });

  it("renders reason and reference link when available", () => {
    const html = renderToStaticMarkup(
      <DirectorInterventionCard
        intervention={{
          id: "intervention-2",
          insertAt: 120.0,
          sourceText: "Python 3.12 で GIL なくなったよね",
          speaker: "小野",
          severity: 4,
          category: "technology",
          correctionScript: "小野さん、GILフリーはPython 3.13からですよ〜!",
          reason: "PEP 703 (free-threaded Python) は Python 3.13 で導入",
          referenceUrl: "https://docs.python.org/3.13/whatsnew/3.13.html",
          status: "pending",
        }}
        disabled={false}
        canSeek
        onChange={() => undefined}
        onSeek={() => undefined}
      />,
    );

    expect(html).toContain("判断根拠:");
    expect(html).toContain("PEP 703 (free-threaded Python) は Python 3.13 で導入");
    expect(html).toContain("参照リンク:");
    expect(html).toContain("https://docs.python.org/3.13/whatsnew/3.13.html");
  });
});
