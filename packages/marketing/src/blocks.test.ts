import { describe, expect, it } from "vitest";
import { renderBlocksToHtml, renderBlocksToText, validateBlocks, type Block } from "./blocks";
import { normalizeContentSnapshot } from "./content-snapshot";

// Mirrors the old renderPlainText/renderHtml logic exactly, so tests can assert
// the new block pipeline reproduces it byte-for-byte for every shape already
// living in the database.
function legacyRenderPlainText(campaignTitle: string, contentSnapshot: Record<string, unknown>) {
  const content = contentSnapshot as { text?: unknown; localOverrides?: Record<string, unknown> };

  if (typeof content.text === "string" && content.text.trim()) {
    return content.text;
  }

  const localPicks = content.localOverrides?.["local-picks"];
  const lines = Array.isArray(localPicks)
    ? localPicks
        .map((pick) => (pick && typeof pick === "object" && "title" in pick ? String((pick as { title: unknown }).title) : null))
        .filter((title): title is string => Boolean(title))
    : [];

  return [campaignTitle, "", ...lines].join("\n").trim() || campaignTitle;
}

function legacyRenderHtml(campaignTitle: string, contentSnapshot: Record<string, unknown>) {
  const text = legacyRenderPlainText(campaignTitle, contentSnapshot);
  return `<p>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("\n", "<br />")}</p>`;
}

describe("normalizeContentSnapshot / renderers", () => {
  it("reproduces the legacy plain-compose {text} shape byte-for-byte", () => {
    const title = "Weekend ideas";
    const raw = { text: "Come and join us this weekend!\nThere's something for everyone." };

    const snapshot = normalizeContentSnapshot(raw, title);
    const html = renderBlocksToHtml(snapshot.blocks);
    const text = renderBlocksToText(snapshot.blocks);

    expect(text).toBe(legacyRenderPlainText(title, raw));
    expect(html).toBe(legacyRenderHtml(title, raw));
  });

  it("reproduces the legacy HQ newsletter-factory {inheritedBlocks, localOverrides} shape byte-for-byte", () => {
    const title = "Autumn family guide";
    // Shape actually produced by addNewsletterEditionOverride / recordTerritoryNewsletterOverride.
    const raw = {
      inheritedBlocks: [{ key: "brand-header", type: "header", locked: true }],
      localOverrides: {
        "local-picks": [{ title: "Sutton park picnic" }, { title: "Library reading trail" }]
      }
    };

    const snapshot = normalizeContentSnapshot(raw, title);
    const html = renderBlocksToHtml(snapshot.blocks);
    const text = renderBlocksToText(snapshot.blocks);

    expect(text).toBe(legacyRenderPlainText(title, raw));
    expect(html).toBe(legacyRenderHtml(title, raw));
  });

  it("falls back to the campaign title when there are no local picks", () => {
    const title = "Autumn National Guide";
    const raw = { inheritedBlocks: [], localOverrides: {} };

    const snapshot = normalizeContentSnapshot(raw, title);

    expect(renderBlocksToText(snapshot.blocks)).toBe(legacyRenderPlainText(title, raw));
    expect(renderBlocksToText(snapshot.blocks)).toBe(title);
    expect(renderBlocksToHtml(snapshot.blocks)).toBe(legacyRenderHtml(title, raw));
  });

  it("falls back to the campaign title for a totally empty/unknown snapshot shape", () => {
    const title = "Untitled draft";
    const raw = {};

    const snapshot = normalizeContentSnapshot(raw, title);

    expect(renderBlocksToText(snapshot.blocks)).toBe(title);
    expect(renderBlocksToHtml(snapshot.blocks)).toBe(`<p>${title}</p>`);
  });

  it("passes an already-structured snapshot through unchanged", () => {
    const blocks: Block[] = [{ id: "b1", type: "heading", level: 1, text: "Hello" }];
    const raw = { version: 1 as const, blocks };

    const snapshot = normalizeContentSnapshot(raw, "Fallback title");

    expect(snapshot).toEqual({ version: 1, blocks });
  });

  it("escapes HTML-significant characters in text content (XSS)", () => {
    const raw = { text: '<script>alert("xss")</script>' };
    const snapshot = normalizeContentSnapshot(raw, "Title");
    const html = renderBlocksToHtml(snapshot.blocks);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes heading, button label and image alt text on render", () => {
    const blocks: Block[] = [
      { id: "b1", type: "heading", level: 2, text: '<img src=x onerror="alert(1)">' },
      { id: "b2", type: "button", label: '"><script>alert(1)</script>', href: "https://example.test" },
      { id: "b3", type: "image", src: "https://example.test/a.png", alt: '<script>alert(1)</script>' }
    ];

    const html = renderBlocksToHtml(blocks);

    expect(html).not.toContain("<script>");
    expect(html).not.toContain('onerror="alert(1)"');
  });

  it("renders every block type to non-throwing HTML and text", () => {
    const blocks: Block[] = [
      { id: "b1", type: "heading", level: 1, text: "Heading" },
      { id: "b2", type: "text", html: "<p>Body copy</p>" },
      { id: "b3", type: "image", src: "https://example.test/a.png", alt: "An image", href: "https://example.test" },
      { id: "b4", type: "button", label: "Shop now", href: "https://example.test/shop" },
      { id: "b5", type: "divider" },
      { id: "b6", type: "raw-html", html: "<div>Imported</div>" }
    ];

    const html = renderBlocksToHtml(blocks);
    const text = renderBlocksToText(blocks);

    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<p>Body copy</p>");
    expect(html).toContain('<a href="https://example.test"><img src="https://example.test/a.png" alt="An image" /></a>');
    expect(html).toContain('<a href="https://example.test/shop" class="r2-email-button">Shop now</a>');
    expect(html).toContain("<hr />");
    expect(html).toContain("<div>Imported</div>");

    expect(text).toContain("Heading");
    expect(text).toContain("Body copy");
    expect(text).toContain("An image");
    expect(text).toContain("Shop now: https://example.test/shop");
    expect(text).toContain("Imported");
  });
});

describe("validateBlocks (untrusted-JSON trust boundary)", () => {
  it("accepts a well-formed array of every block type", () => {
    const raw = [
      { id: "b1", type: "heading", text: "Hello", level: 1 },
      { id: "b2", type: "text", html: "<p>Body</p>" },
      { id: "b3", type: "image", src: "https://example.test/a.png", alt: "Alt text", href: "https://example.test" },
      { id: "b4", type: "button", label: "Shop", href: "https://example.test/shop" },
      { id: "b5", type: "divider" },
      { id: "b6", type: "raw-html", html: "<div>Imported</div>" }
    ];

    expect(validateBlocks(raw)).toEqual([
      { id: "b1", type: "heading", text: "Hello", level: 1 },
      { id: "b2", type: "text", html: "<p>Body</p>" },
      { id: "b3", type: "image", src: "https://example.test/a.png", alt: "Alt text", href: "https://example.test", fileId: null },
      { id: "b4", type: "button", label: "Shop", href: "https://example.test/shop" },
      { id: "b5", type: "divider" },
      { id: "b6", type: "raw-html", html: "<div>Imported</div>", sourceLabel: null }
    ]);
  });

  it("rejects a non-array payload", () => {
    expect(() => validateBlocks({ not: "an array" })).toThrow("must be an array");
  });

  it("rejects a block missing an id", () => {
    expect(() => validateBlocks([{ type: "heading", text: "Hi", level: 1 }])).toThrow(/missing a valid id/);
  });

  it("rejects an unknown block type", () => {
    expect(() => validateBlocks([{ id: "b1", type: "video", src: "https://example.test/v.mp4" }])).toThrow(/unknown block type/);
  });

  it("rejects a javascript: URL in a button href", () => {
    expect(() =>
      validateBlocks([{ id: "b1", type: "button", label: "Click me", href: "javascript:alert(1)" }])
    ).toThrow(/href must be a valid/);
  });

  it("rejects a javascript: URL in an image src", () => {
    expect(() =>
      validateBlocks([{ id: "b1", type: "image", src: "javascript:alert(1)", alt: "x" }])
    ).toThrow(/src must be a valid/);
  });

  it("rejects a heading with an invalid level", () => {
    expect(() => validateBlocks([{ id: "b1", type: "heading", text: "Hi", level: 3 }])).toThrow(/level must be 1 or 2/);
  });
});
