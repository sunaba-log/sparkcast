import { describe, expect, it } from "vitest";
import { formatTimestamp } from "@/lib/timestamp";

describe("formatTimestamp", () => {
  it("formats seconds like the minutes table of contents", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(65.9)).toBe("1:05");
    expect(formatTimestamp(3725)).toBe("1:02:05");
    expect(formatTimestamp(-3)).toBe("0:00");
  });
});
