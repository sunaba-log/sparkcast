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

    expect(html).toContain("00:12:32.500 - 00:12:34.500");
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
          start: 750.0,
          end: 754.5,
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

    expect(html).toContain("00:12:30.000 - 00:12:34.500");
    expect(html).toContain("深刻度4/5");
    expect(html).toContain("事実誤認");
    expect(html).toContain("田中の発話");
    expect(html).toContain("この製品は2020年に発売されました。");
    expect(html).toContain("開始（秒）");
    expect(html).toContain("終了（秒）");
    expect(html).toContain("対象範囲を再生");
    expect(html).toContain("前後を含めて再生");
    expect(html).toContain("訂正を挿入");
    expect(html).toContain("カット");
    expect(html).toContain("無音化");
    expect(html).toContain("代替音声で置換");
    expect(html).toContain("AIディレクターの台詞提案");
    expect(html).toContain("正しくは2021年発売です。");
    expect(html).toContain("承認");
    expect(html).toContain("却下");
  });

  it("renders action description when action is cut or silence", () => {
    const cutHtml = renderToStaticMarkup(
      <DirectorInterventionCard
        intervention={{
          id: "intervention-cut",
          insertAt: 100,
          sourceText: "カット対象の発話です。",
          speaker: "田中",
          severity: 3,
          category: "事実誤認",
          correctionScript: "訂正スクリプト",
          status: "pending",
          action: "cut",
        }}
        defaultExpanded={true}
        disabled={false}
        canSeek
        onChange={() => undefined}
        onSeek={() => undefined}
      />,
    );
    expect(cutHtml).toContain("を音声から削除します。");
    expect(cutHtml).not.toContain("AIディレクターの台詞提案");

    const silenceHtml = renderToStaticMarkup(
      <DirectorInterventionCard
        intervention={{
          id: "intervention-silence",
          insertAt: 100,
          sourceText: "無音化対象の発話です。",
          speaker: "田中",
          severity: 3,
          category: "事実誤認",
          correctionScript: "訂正スクリプト",
          status: "pending",
          action: "silence",
        }}
        defaultExpanded={true}
        disabled={false}
        canSeek
        onChange={() => undefined}
        onSeek={() => undefined}
      />,
    );
    expect(silenceHtml).toContain("を無音化します。");
    expect(silenceHtml).not.toContain("AIディレクターの台詞提案");
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
        defaultExpanded={true}
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

  it("renders voice synthesis and recording controls for insert and replace actions", () => {
    const insertHtml = renderToStaticMarkup(
      <DirectorInterventionCard
        episodeId="ep-123"
        intervention={{
          id: "intervention-voice-insert",
          insertAt: 50.0,
          sourceText: "テスト発話",
          speaker: "ホスト",
          severity: 2,
          category: "事実誤認",
          correctionScript: "訂正します",
          status: "pending",
          action: "insert",
        }}
        defaultExpanded={true}
        disabled={false}
        canSeek
        onChange={() => undefined}
        onSeek={() => undefined}
      />,
    );
    expect(insertHtml).toContain("合成音声");
    expect(insertHtml).toContain("ブラウザ録音");
    expect(insertHtml).toContain("台詞から音声を生成");
    expect(insertHtml).toContain("編集後の前後を確認");

    const replaceHtml = renderToStaticMarkup(
      <DirectorInterventionCard
        episodeId="ep-123"
        intervention={{
          id: "intervention-voice-replace",
          insertAt: 50.0,
          sourceText: "テスト発話",
          speaker: "ホスト",
          severity: 2,
          category: "事実誤認",
          correctionScript: "代替台詞です",
          status: "pending",
          action: "replace",
        }}
        defaultExpanded={true}
        disabled={false}
        canSeek
        onChange={() => undefined}
        onSeek={() => undefined}
      />,
    );
    expect(replaceHtml).toContain("代替台詞");
    expect(replaceHtml).toContain("合成音声");
    expect(replaceHtml).toContain("ブラウザ録音");
    expect(replaceHtml).toContain("台詞から音声を生成");
    expect(replaceHtml).toContain("編集後の前後を確認");
  });
});
