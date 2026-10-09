import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont } from "pdf-lib";

export type AgreementContent = { title: string; reference: string; paragraphs: Array<{ heading?: string; text: string }> };

/** Pulls the printable text out of an agreement's generated content: a title, a body, and optional headed sections. */
export function agreementContentFrom(generated: Record<string, unknown>, reference: string): AgreementContent {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const paragraphs: AgreementContent["paragraphs"] = [];
  if (text(generated.body)) paragraphs.push({ text: text(generated.body) });
  if (Array.isArray(generated.sections)) {
    for (const section of generated.sections as Array<Record<string, unknown>>) {
      if (section && typeof section === "object" && (text(section.body) || text(section.heading))) paragraphs.push({ heading: text(section.heading) || undefined, text: text(section.body) });
    }
  }
  return { title: text(generated.title) || "Agreement", reference, paragraphs };
}

/**
 * The standard PDF fonts only hold Latin-1 characters. Typographic punctuation is translated to its plain form and
 * anything else outside Latin-1 becomes "?", so a stray symbol can never stop an agreement being sent.
 */
export function toLatin1(value: string): string {
  const map: Record<string, string> = { "‘": "'", "’": "'", "‚": "'", "“": '"', "”": '"', "„": '"', "–": "-", "—": "-", "−": "-", "…": "...", " ": " ", "•": "*", "€": "EUR " };
  return Array.from(value.normalize("NFC"))
    .map((char) => {
      if (map[char]) return map[char];
      const code = char.codePointAt(0)!;
      if (char === "\n" || char === "\t") return char;
      if (code < 32 || (code >= 127 && code < 160)) return "";
      return code <= 255 ? char : "?";
    })
    .join("");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const raw of text.replace(/\t/g, "    ").split("\n")) {
    if (raw.trim() === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of raw.split(/\s+/).filter(Boolean)) {
      // A single word longer than the line is broken rather than overflowing the page.
      let piece = word;
      while (font.widthOfTextAtSize(piece, size) > maxWidth) {
        let cut = piece.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(piece.slice(0, cut), size) > maxWidth) cut -= 1;
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(piece.slice(0, cut));
        piece = piece.slice(cut);
      }
      const candidate = line ? `${line} ${piece}` : piece;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
      else {
        lines.push(line);
        line = piece;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** A plain, readable A4 PDF of the agreement. SignWell adds the signature page after it. */
export async function renderAgreementPdf(content: AgreementContent): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [width, height] = [595.28, 841.89];
  const margin = 56;
  const bodySize = 10.5;
  const lineHeight = 14.5;
  const maxWidth = width - margin * 2;
  const footer = toLatin1(`${content.reference}`);

  let page = pdf.addPage([width, height]);
  let y = height - margin;
  const ensure = (needed: number) => {
    if (y - needed < margin + 12) {
      page = pdf.addPage([width, height]);
      y = height - margin;
    }
  };
  const draw = (text: string, font: PDFFont, size: number, gap = lineHeight) => {
    ensure(gap);
    if (text) page.drawText(text, { x: margin, y: y - size, size, font, color: rgb(0.1, 0.1, 0.15) });
    y -= gap;
  };

  for (const line of wrap(toLatin1(content.title), bold, 18, maxWidth)) draw(line, bold, 18, 24);
  y -= 8;
  for (const paragraph of content.paragraphs) {
    if (paragraph.heading) {
      y -= 4;
      for (const line of wrap(toLatin1(paragraph.heading), bold, 12, maxWidth)) draw(line, bold, 12, 17);
    }
    for (const line of wrap(toLatin1(paragraph.text), regular, bodySize, maxWidth)) draw(line, regular, bodySize);
    y -= 6;
  }

  const pages = pdf.getPages();
  pages.forEach((target, index) => {
    target.drawText(`${footer}  -  page ${index + 1} of ${pages.length}`, { x: margin, y: 30, size: 8, font: regular, color: rgb(0.4, 0.4, 0.45) });
  });
  pdf.setTitle(toLatin1(content.title));
  pdf.setProducer("Raring2go");
  return pdf.save();
}
