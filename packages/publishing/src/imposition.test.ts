import { describe, expect, it } from "vitest";
import { ImpositionError, imposedReadingOrder, paddedPageCount, saddleStitchSheets } from "./imposition";

describe("saddle-stitch imposition", () => {
  it("lays out an 8-page booklet", () => {
    expect(saddleStitchSheets(8)).toEqual([
      { sheet: 1, front: { left: 8, right: 1 }, back: { left: 2, right: 7 } },
      { sheet: 2, front: { left: 6, right: 3 }, back: { left: 4, right: 5 } }
    ]);
  });
  it("uses every page exactly once, and pairs always sum to n + 1", () => {
    for (const n of [4, 8, 12, 36, 100]) {
      const order = imposedReadingOrder(n);
      expect(order).toHaveLength(n);
      expect(new Set(order).size).toBe(n);
      for (const sheet of saddleStitchSheets(n)) {
        expect(sheet.front.left! + sheet.front.right!).toBe(n + 1);
        expect(sheet.back.left! + sheet.back.right!).toBe(n + 1);
      }
    }
  });
  it("puts the cover with the back cover on the outer front, and the middle pages on the inner sheet", () => {
    const sheets = saddleStitchSheets(36);
    expect(sheets[0]!.front).toEqual({ left: 36, right: 1 });
    expect(sheets.at(-1)!.front).toEqual({ left: 20, right: 17 });
    expect(sheets.at(-1)!.back).toEqual({ left: 18, right: 19 });
  });
  it("pads with blanks to a multiple of 4 and rejects nonsense", () => {
    expect(paddedPageCount(5)).toBe(8);
    expect(saddleStitchSheets(6).flatMap((s) => [s.front.left, s.front.right, s.back.left, s.back.right]).filter((p) => p === null)).toHaveLength(2);
    expect(() => paddedPageCount(0)).toThrow(ImpositionError);
  });
});
