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
});
