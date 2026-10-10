import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PolicyFindingCard } from "@/components/PolicyFindingsPanel";

describe("PolicyFindingCard", () => {
  it("renders the summary when collapsed", () => {
    const html = renderToStaticMarkup(
      <PolicyFindingCard
        finding={{
          id: "finding-1",
          chunkId: "c1",
          category: "pii",
          source: "presidio",
          start: 126.2,
          end: 128.6,
          text: "090-1234-5678",
          entityType: "電話番号",
          action: "silence",
          status: "pending",
        }}
        defaultExpanded={false}
        disabled={false}
        canSeek
        onSeek={() => undefined}
        onChangeStatus={() => undefined}
      />,
    );

    expect(html).toContain("2:06.200 - 2:08.600");
    expect(html).toContain("PII");
    expect(html).toContain("電話番号");
    expect(html).not.toContain("検知された発話");
  });

  it("renders the details and action buttons when expanded", () => {
    const html = renderToStaticMarkup(
      <PolicyFindingCard
        finding={{
          id: "finding-1",
          chunkId: "c1",
          category: "pii",
          source: "presidio",
          start: 126.2,
          end: 128.6,
          text: "090-1234-5678",
          entityType: "電話番号",
          action: "silence",
          status: "pending",
        }}
        defaultExpanded={true}
        disabled={false}
        canSeek
        onSeek={() => undefined}
        onChangeStatus={() => undefined}
      />,
    );

    expect(html).toContain("2:06.200 - 2:08.600");
    expect(html).toContain("PII");
    expect(html).toContain("電話番号");
    expect(html).toContain("検知された発話");
    expect(html).toContain("090-1234-5678");
    expect(html).toContain("AIディレクターの台詞提案");
    expect(html).toContain("無音化");
    expect(html).toContain("却下");
  });
});
