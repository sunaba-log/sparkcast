import { describe, expect, it } from "vitest";
import { mapSourceTime, type AudioTimelinePiece } from "./timeline";
const timeline: AudioTimelinePiece[] = [
  {
    sourceStartMs: 0,
    sourceEndMs: 1000,
    outputStartMs: 0,
    outputEndMs: 1000,
    kind: "original",
  },
  {
    sourceStartMs: 1000,
    sourceEndMs: 2000,
    outputStartMs: 1000,
    outputEndMs: 1000,
    kind: "cut",
  },
  {
    sourceStartMs: 2000,
    sourceEndMs: 3000,
    outputStartMs: 1000,
    outputEndMs: 2000,
    kind: "original",
  },
  {
    sourceStartMs: 3000,
    sourceEndMs: 4000,
    outputStartMs: 2000,
    outputEndMs: 2500,
    kind: "replace",
  },
];
describe("rendition timeline", () => {
  it("hides deleted positions and maps later original and replacement positions", () => {
    expect(mapSourceTime(1.5, timeline)).toBeNull();
    expect(mapSourceTime(2.5, timeline)).toBe(1.5);
    expect(mapSourceTime(3.5, timeline)).toBe(2);
    expect(mapSourceTime(4, timeline)).toBe(2.5);
  });
});
