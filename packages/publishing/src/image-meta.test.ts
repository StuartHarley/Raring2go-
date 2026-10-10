import { describe, expect, it } from "vitest";
import { printResolutionDpi, readImageSize } from "./image-meta";

const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
const jpeg = (w: number, h: number) => {
  // SOI, an APP0 segment to skip, then SOF0 with height then width.
  const b = new Uint8Array(2 + 18 + 19);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const v = new DataView(b.buffer);
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20);
  v.setUint16(25, h);
  v.setUint16(27, w);
  return b;
};
const gif = (w: number, h: number) => {
  const b = new Uint8Array(13);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  new DataView(b.buffer).setUint16(6, w, true);
  new DataView(b.buffer).setUint16(8, h, true);
  return b;
};
const webpLossless = (w: number, h: number) => {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0, 0, 0, 0, 0x2f]);
  new DataView(b.buffer).setUint32(21, (w - 1) | ((h - 1) << 14), true);
  return b;
};

describe("image size", () => {
  it("reads PNG, JPEG, GIF and WebP", () => {
    expect(readImageSize(png(2480, 3508))).toEqual({ format: "png", widthPx: 2480, heightPx: 3508 });
    expect(readImageSize(jpeg(1600, 900))).toEqual({ format: "jpeg", widthPx: 1600, heightPx: 900 });
    expect(readImageSize(gif(64, 32))).toEqual({ format: "gif", widthPx: 64, heightPx: 32 });
    expect(readImageSize(webpLossless(800, 600))).toEqual({ format: "webp", widthPx: 800, heightPx: 600 });
  });
  it("refuses anything else, truncated files and absurd sizes", () => {
    expect(readImageSize(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(readImageSize(new Uint8Array(0))).toBeNull();
    expect(readImageSize(png(2480, 3508).slice(0, 18))).toBeNull();
    expect(readImageSize(jpeg(1, 1).slice(0, 22))).toBeNull();
    expect(readImageSize(png(0, 10))).toBeNull();
    expect(readImageSize(png(40000, 10))).toBeNull();
  });
  it("computes print resolution", () => {
    expect(printResolutionDpi(2480, 210)).toBe(300);
    expect(printResolutionDpi(1000, 210)).toBe(121);
  });
});
