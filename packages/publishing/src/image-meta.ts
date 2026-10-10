/**
 * Reads an image's pixel size from its own bytes. The size feeds print preflight (resolution = pixels over the
 * printed width), so it is read from the file, never taken from what the browser or the editor claims.
 */

export type ImageSize = { format: "png" | "jpeg" | "webp" | "gif"; widthPx: number; heightPx: number };

const MAX_PIXELS_PER_SIDE = 30_000;

function valid(format: ImageSize["format"], widthPx: number, heightPx: number): ImageSize | null {
  return widthPx > 0 && heightPx > 0 && widthPx <= MAX_PIXELS_PER_SIDE && heightPx <= MAX_PIXELS_PER_SIDE ? { format, widthPx, heightPx } : null;
}

export function readImageSize(bytes: Uint8Array): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));

  // PNG: signature, then the IHDR chunk with big-endian width and height.
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR") {
    return valid("png", view.getUint32(16), view.getUint32(20));
  }

  // GIF: logical screen size, little-endian.
  if (bytes.length >= 10 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) {
    return valid("gif", view.getUint16(6, true), view.getUint16(8, true));
  }

  // JPEG: walk the segments to the first start-of-frame marker.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1]!;
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        offset += 2;
        continue;
      }
      const length = view.getUint16(offset + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) {
        if (offset + 9 > bytes.length) return null;
        return valid("jpeg", view.getUint16(offset + 7), view.getUint16(offset + 5));
      }
      if (length < 2) return null;
      offset += 2 + length;
    }
    return null;
  }

  // WebP: RIFF container; lossy (VP8), lossless (VP8L) or extended (VP8X).
  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8X") return valid("webp", 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)), 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)));
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return valid("webp", (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return valid("webp", view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    }
  }
  return null;
}

/** Pixels per inch an image will print at when placed across the given width. */
export function printResolutionDpi(widthPx: number, placedWidthMm: number): number {
  return Math.round(widthPx / (placedWidthMm / 25.4));
}
