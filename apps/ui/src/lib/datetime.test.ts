import { describe, expect, it } from "vitest";
import { formatJstDate, formatJstDateTime, jstParts } from "@/lib/datetime";

describe("datetime", () => {
  it("formats in Japan time regardless of the runtime time zone", () => {
    expect(formatJstDateTime("2026-10-03T16:05:00.000Z")).toBe("2026/10/04 01:05");
    expect(formatJstDate("2026-10-04T22:23:00Z")).toBe("2026-10-05");
    expect(jstParts("2026-10-03T23:59:00Z")).toEqual({ year: "2026", month: "10", day: "04", hour: "08", minute: "59" });
  });

  it("keeps an unparsable value as is", () => {
    expect(formatJstDateTime("not a date")).toBe("not a date");
    expect(jstParts("not a date")).toBeNull();
  });
});
