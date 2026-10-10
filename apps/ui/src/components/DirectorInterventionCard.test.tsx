import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DirectorInterventionCard } from "@/components/DirectorInterventionCard";

describe("DirectorInterventionCard", () => {
  it("renders the audit summary when collapsed", () => {
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
        defaultExpanded={false}
        disabled={false}
        canSeek
        onChange={() => undefined}
        onSeek={() => undefined}
      />,
    );

    expect(html).toContain("00:12:34.500");
    expect(html).toContain("深刻度4/5");
    expect(html).toContain("事実誤認");
    expect(html).not.toContain("田中の発話");
  });

  it("renders the audit details and editable correction script when expanded", () => {
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
        defaultExpanded={true}
        disabled={false}
        canSeek
        onChange={() => undefined}
        onSeek={() => undefined}
      />,
    );

    expect(html).toContain("00:12:34.500");
    expect(html).toContain("深刻度4/5");
    expect(html).toContain("事実誤認");
    expect(html).toContain("田中の発話");
    expect(html).toContain("この製品は2020年に発売されました。");
    expect(html).toContain("AIディレクターの台詞提案");
    expect(html).toContain("正しくは2021年発売です。");
    expect(html).toContain("承認");
    expect(html).toContain("却下");
  });
});
