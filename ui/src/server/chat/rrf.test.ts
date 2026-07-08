import { describe, expect, it } from "vitest";
import { fuseReciprocalRank } from "@/server/chat/rrf";

const key = (item: string) => item;

describe("fuseReciprocalRank", () => {
  it("空のランキングからは空を返す", () => {
    expect(fuseReciprocalRank([], key, 5)).toEqual([]);
    expect(fuseReciprocalRank([[], []], key, 5)).toEqual([]);
  });

  it("両方のランキングに現れる項目を上位にする", () => {
    const bm25 = ["a", "b", "c"];
    const knn = ["d", "b", "e"];
    const fused = fuseReciprocalRank([bm25, knn], key, 5);
    // b は両ランキングで 2 位（1/62 + 1/62）で、単独 1 位（1/61）より高い。
    expect(fused[0]).toBe("b");
    expect(fused).toHaveLength(5);
  });

  it("単一ランキングでは元の順序を保つ", () => {
    expect(fuseReciprocalRank([["a", "b", "c"]], key, 3)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("limit 件に切り詰める", () => {
    const fused = fuseReciprocalRank([["a", "b", "c", "d"]], key, 2);
    expect(fused).toEqual(["a", "b"]);
  });

  it("同点は先に現れたランキング順を優先する", () => {
    const fused = fuseReciprocalRank([["a"], ["b"]], key, 2);
    expect(fused).toEqual(["a", "b"]);
  });
});
