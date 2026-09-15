import { randomUUID } from "node:crypto";

export type BlockBase = { id: string };

export type HeadingBlock = BlockBase & { type: "heading"; text: string; level: 1 | 2 };
export type TextBlock = BlockBase & { type: "text"; html: string };
export type ImageBlock = BlockBase & { type: "image"; src: string; alt: string; href?: string | null; fileId?: string | null };
export type ButtonBlock = BlockBase & { type: "button"; label: string; href: string };
export type DividerBlock = BlockBase & { type: "divider" };
export type RawHtmlBlock = BlockBase & { type: "raw-html"; html: string; sourceLabel?: string | null };

export type Block = HeadingBlock | TextBlock | ImageBlock | ButtonBlock | DividerBlock | RawHtmlBlock;

export type StructuredContentSnapshot = { version: 1; blocks: Block[] };

const KNOWN_BLOCK_TYPES = new Set<Block["type"]>(["heading", "text", "image", "button", "divider", "raw-html"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeStructuredSnapshot(raw: Record<string, unknown>): raw is { version: 1; blocks: unknown[] } {
  return (
    raw.version === 1 &&
    Array.isArray(raw.blocks) &&
    raw.blocks.every(
      (block) => isRecord(block) && typeof block.id === "string" && typeof block.type === "string" && KNOWN_BLOCK_TYPES.has(block.type as Block["type"])
    )
  );
}

/**
 * Upgrades every content-snapshot shape found in the database to the structured
 * block form. Two legacy shapes exist: `{ text }` from the plain compose form,
 * and `{ inheritedBlocks, localOverrides }` from the HQ newsletter factory (where
 * only `localOverrides["local-picks"]` ever reached a real send). Both are folded
 * into a single TextBlock whose rendered HTML/plain-text is byte-for-byte
 * identical to the pre-block-model renderer, so this is a transparent refactor
 * for every campaign already in the database.
 */
export function normalizeContentSnapshot(raw: Record<string, unknown>, fallbackTitle: string): StructuredContentSnapshot {
  if (looksLikeStructuredSnapshot(raw)) {
    return { version: 1, blocks: raw.blocks as Block[] };
  }

  if (typeof raw.text === "string" && raw.text.trim()) {
    return { version: 1, blocks: [textBlock(raw.text)] };
  }

  const localOverrides = isRecord(raw.localOverrides) ? raw.localOverrides : {};
  const localPicks = localOverrides["local-picks"];
  const lines = Array.isArray(localPicks)
    ? localPicks
        .map((pick) => (isRecord(pick) && "title" in pick ? String(pick.title) : null))
        .filter((title): title is string => Boolean(title))
    : [];
  const legacyText = [fallbackTitle, "", ...lines].join("\n").trim() || fallbackTitle;

  return { version: 1, blocks: [textBlock(legacyText)] };
}

function textBlock(text: string): TextBlock {
  return { id: randomUUID(), type: "text", html: `<p>${escapeHtml(text).replaceAll("\n", "<br />")}</p>` };
}

export function renderBlocksToHtml(blocks: Block[]): string {
  return blocks.map(renderBlockToHtml).join("");
}

function renderBlockToHtml(block: Block): string {
  switch (block.type) {
    case "heading":
      return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
    case "text":
    case "raw-html":
      // Already a complete, trusted HTML fragment (sanitized at write time) —
      // rendered verbatim, not re-escaped or re-wrapped.
      return block.html;
    case "image": {
      const img = `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" />`;
      return block.href ? `<a href="${escapeHtml(block.href)}">${img}</a>` : img;
    }
    case "button":
      return `<a href="${escapeHtml(block.href)}" class="r2-email-button">${escapeHtml(block.label)}</a>`;
    case "divider":
      return "<hr />";
  }
}

export function renderBlocksToText(blocks: Block[]): string {
  return blocks
    .map(renderBlockToText)
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function renderBlockToText(block: Block): string {
  switch (block.type) {
    case "heading":
      return block.text;
    case "text":
    case "raw-html":
      return htmlToPlainText(block.html);
    case "image":
      return block.alt || block.href || "";
    case "button":
      return `${block.label}: ${block.href}`;
    case "divider":
      return "";
  }
}

function htmlToPlainText(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, "");
  return unescapeHtml(stripped);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function unescapeHtml(value: string) {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}
