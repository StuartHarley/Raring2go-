import { PDFDocument, PDFName, cmyk } from "pdf-lib";

/**
 * Print geometry written into the PDF itself. Chromium produces pages of the right size but knows nothing about trim
 * or bleed, so the printer's software would have to guess. These steps record the TrimBox and BleedBox, and build the
 * imposed booklet, using real PDF operations that are tested on real PDFs (not just argument lists).
 */

const PT_PER_MM = 72 / 25.4;
export const pt = (mm: number) => mm * PT_PER_MM;

export type SheetGeometry = { trimWidthMm: number; trimHeightMm: number; bleedMm: number; marginMm: number };

export async function setPageBoxes(bytes: Uint8Array, geometry: SheetGeometry): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const { trimWidthMm: tw, trimHeightMm: th, bleedMm: b, marginMm: m } = geometry;
  for (const page of doc.getPages()) {
    page.setTrimBox(pt(m), pt(m), pt(tw), pt(th));
    page.setBleedBox(pt(m - b), pt(m - b), pt(tw + 2 * b), pt(th + 2 * b));
  }
  return doc.save({ useObjectStreams: false });
}

export type PageBoxes = { media: [number, number, number, number]; trim: [number, number, number, number] | null; bleed: [number, number, number, number] | null };

/** Reads the boxes back, in millimetres, so a test (and the report) can state what the file really contains. */
export async function readPageBoxes(bytes: Uint8Array): Promise<PageBoxes[]> {
  const doc = await PDFDocument.load(bytes);
  const mm = (box: { x: number; y: number; width: number; height: number }): [number, number, number, number] => [box.x / PT_PER_MM, box.y / PT_PER_MM, box.width / PT_PER_MM, box.height / PT_PER_MM];
  return doc.getPages().map((page) => {
    const trim = page.node.TrimBox();
    const bleed = page.node.BleedBox();
    const read = (rect: typeof trim) => (rect ? mm({ x: rect.asRectangle().x, y: rect.asRectangle().y, width: rect.asRectangle().width, height: rect.asRectangle().height }) : null);
    return { media: mm(page.getMediaBox()), trim: read(trim), bleed: read(bleed) };
  });
}

export type ImposedSide = { left: number | null; right: number | null };
export type ImposedSheet = { sheet: number; front: ImposedSide; back: ImposedSide };

/**
 * Places the pages of a saddle-stitch booklet onto press sheets. `sheets` comes from the same ordering the app uses.
 * Each page is cut to its bleed box except on the spine side, where it is cut at the trim so a page's bleed never
 * prints over its neighbour. Crop marks go at the outer corners of each side and fold marks at the spine.
 * Not handled, on purpose: creep (shingling), gripper margins and press-sheet sizes. Those need the printer's spec.
 */
export async function imposeBooklet(bytes: Uint8Array, geometry: SheetGeometry, sheets: ImposedSheet[]): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes);
  const pageCount = source.getPageCount();
  const out = await PDFDocument.create();
  const { trimWidthMm: tw, trimHeightMm: th, bleedMm: b, marginMm: m } = geometry;
  const sheetW = pt(2 * tw + 2 * m);
  const sheetH = pt(th + 2 * m);
  const sourcePages = source.getPages();
  // A page with nothing on it can come out of the browser with no content stream at all, which cannot be embedded.
  for (const page of sourcePages) {
    if (!page.node.Contents()) page.node.set(PDFName.of("Contents"), source.context.register(source.context.stream("")));
  }
  const black = cmyk(0, 0, 0, 1);

  const cache = new Map<string, Awaited<ReturnType<typeof out.embedPage>>>();
  const embed = async (pageNumber: number, side: "left" | "right") => {
    if (pageNumber < 1 || pageNumber > pageCount) throw new Error(`Page ${pageNumber} is not in the file.`);
    const key = `${pageNumber}:${side}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const box = side === "left"
      ? { left: pt(m - b), bottom: pt(m - b), right: pt(m + tw), top: pt(m + th + b) }
      : { left: pt(m), bottom: pt(m - b), right: pt(m + tw + b), top: pt(m + th + b) };
    const embedded = await out.embedPage(sourcePages[pageNumber - 1]!, box);
    cache.set(key, embedded);
    return embedded;
  };

  for (const sheet of sheets) {
    for (const side of [sheet.front, sheet.back]) {
      const page = out.addPage([sheetW, sheetH]);
      if (side.left !== null) page.drawPage(await embed(side.left, "left"), { x: pt(m - b), y: pt(m - b) });
      if (side.right !== null) page.drawPage(await embed(side.right, "right"), { x: pt(m + tw), y: pt(m - b) });
      const mark = (x1: number, y1: number, x2: number, y2: number) => page.drawLine({ start: { x: pt(x1), y: pt(y1) }, end: { x: pt(x2), y: pt(y2) }, thickness: 0.25, color: black });
      const len = 5;
      for (const x of [m, m + 2 * tw]) {
        const outward = x === m ? -1 : 1;
        for (const y of [m, m + th]) {
          const down = y === m ? -1 : 1;
          mark(x + outward * b, y, x + outward * (b + len), y);
          mark(x, y + down * b, x, y + down * (b + len));
        }
      }
      // Fold marks at the spine, in the margin above and below the sheet's printed area.
      mark(m + tw, m + th + b, m + tw, m + th + b + len);
      mark(m + tw, m - b, m + tw, m - b - len);
      page.setTrimBox(pt(m), pt(m), pt(2 * tw), pt(th));
      page.setBleedBox(pt(m - b), pt(m - b), pt(2 * tw + 2 * b), pt(th + 2 * b));
    }
  }
  return out.save({ useObjectStreams: false });
}

/** True when every page has a TrimBox and BleedBox and the trim has the width that was asked for. */
export async function boxesMatch(bytes: Uint8Array, trimWidthMm: number, expectedPages: number): Promise<boolean> {
  const boxes = await readPageBoxes(bytes);
  return boxes.length === expectedPages && boxes.every((box) => box.trim !== null && box.bleed !== null && Math.abs(box.trim[2] - trimWidthMm) < 0.1);
}
