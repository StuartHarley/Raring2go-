import { PDFDocument, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { imposeBooklet, pt, readPageBoxes, setPageBoxes } from "./boxes.js";
import type { ImposedSheet, SheetGeometry } from "./boxes.js";

const geometry: SheetGeometry = { trimWidthMm: 210, trimHeightMm: 297, bleedMm: 3, marginMm: 9 };
const sheetMm = { w: 210 + 18, h: 297 + 18 };

async function sourcePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([pt(sheetMm.w), pt(sheetMm.h)]);
    page.drawRectangle({ x: pt(9), y: pt(9), width: pt(210), height: pt(297), color: rgb(0.1 * (i % 9), 0.5, 0.5) });
  }
  return doc.save();
}

const near = (actual: number | undefined, expected: number) => expect(actual).toBeCloseTo(expected, 1);

describe("page boxes", () => {
  it("records the trim and bleed boxes on every page", async () => {
    const out = await setPageBoxes(await sourcePdf(3), geometry);
    const boxes = await readPageBoxes(out);
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect(box.trim).not.toBeNull();
      near(box.trim![0], 9); near(box.trim![1], 9); near(box.trim![2], 210); near(box.trim![3], 297);
      near(box.bleed![0], 6); near(box.bleed![2], 216); near(box.bleed![3], 303);
      near(box.media[2], sheetMm.w); near(box.media[3], sheetMm.h);
    }
  });
  it("reports a file with no boxes as having none", async () => {
    const boxes = await readPageBoxes(await sourcePdf(1));
    expect(boxes[0]!.trim).toBeNull();
  });
});

describe("booklet imposition", () => {
  const sheets: ImposedSheet[] = [
    { sheet: 1, front: { left: 8, right: 1 }, back: { left: 2, right: 7 } },
    { sheet: 2, front: { left: 6, right: 3 }, back: { left: 4, right: 5 } }
  ];
  it("produces two spreads per sheet at twice the trim width, with boxes", async () => {
    const out = await imposeBooklet(await setPageBoxes(await sourcePdf(8), geometry), geometry, sheets);
    const boxes = await readPageBoxes(out);
    expect(boxes).toHaveLength(4);
    for (const box of boxes) {
      near(box.media[2], 2 * 210 + 18);
      near(box.media[3], 297 + 18);
      near(box.trim![2], 420); near(box.trim![3], 297);
      near(box.bleed![2], 426);
    }
  });
  it("leaves a blank pad page empty and refuses a page that is not in the file", async () => {
    const padded = await imposeBooklet(await sourcePdf(3), geometry, [{ sheet: 1, front: { left: null, right: 1 }, back: { left: 2, right: 3 } }]);
    expect(await readPageBoxes(padded)).toHaveLength(2);
    await expect(imposeBooklet(await sourcePdf(2), geometry, [{ sheet: 1, front: { left: 8, right: 1 }, back: { left: 2, right: 7 } }])).rejects.toThrow(/not in the file/);
  });
});
