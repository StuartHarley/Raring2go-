/**
 * Saddle-stitch booklet imposition: which pages go where on each press sheet, so the folded and stitched
 * sheets read in page order. Pure ordering only; placing the pages is the render service's job.
 *
 * A sheet has a front and a back, each carrying two pages side by side (left, right). For a booklet of n pages
 * (a multiple of 4), sheet i (0-based, outermost first) is:
 *   front: [n - 2i, 2i + 1]      back: [2i + 2, n - 2i - 1]
 * so the cover (1) and the back cover (n) share the outer front, and the middle pages share the innermost sheet.
 * Page numbers are 1-based. `null` marks a blank pad page.
 */

export type ImposedSide = { left: number | null; right: number | null };
export type ImposedSheet = { sheet: number; front: ImposedSide; back: ImposedSide };

export class ImpositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImpositionError";
  }
}

/** A saddle-stitched booklet is built from sheets of four pages, so the count is rounded up to a multiple of 4. */
export function paddedPageCount(pageCount: number): number {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new ImpositionError("A booklet needs at least one page.");
  return Math.ceil(pageCount / 4) * 4;
}

export function saddleStitchSheets(pageCount: number): ImposedSheet[] {
  const total = paddedPageCount(pageCount);
  const page = (n: number): number | null => (n <= pageCount ? n : null);
  const sheets: ImposedSheet[] = [];
  for (let i = 0; i < total / 4; i += 1) {
    sheets.push({
      sheet: i + 1,
      front: { left: page(total - 2 * i), right: page(2 * i + 1) },
      back: { left: page(2 * i + 2), right: page(total - 2 * i - 1) }
    });
  }
  return sheets;
}

/** Pages in the order they appear on the imposed file: front then back of each sheet, left then right. */
export function imposedReadingOrder(pageCount: number): Array<number | null> {
  return saddleStitchSheets(pageCount).flatMap((sheet) => [sheet.front.left, sheet.front.right, sheet.back.left, sheet.back.right]);
}
