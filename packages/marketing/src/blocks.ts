// This module must stay free of Node-only imports (no `node:*`, no DB/audit
// packages) — it is exposed to client components via the
// "@raring2go/marketing/blocks" subpath export for the live editor preview
// (see BlockEditor.tsx). Server-only helpers that build blocks (e.g.
// normalizeContentSnapshot) live in content-snapshot.ts instead.

export type BlockBase = { id: string; visibleSegmentId?: string | null };

export type HeadingBlock = BlockBase & { type: "heading"; text: string; level: 1 | 2 };
export type TextBlock = BlockBase & { type: "text"; html: string };
export type ImageBlock = BlockBase & { type: "image"; src: string; alt: string; href?: string | null; fileId?: string | null };
export type ButtonBlock = BlockBase & { type: "button"; label: string; href: string };
export type DividerBlock = BlockBase & { type: "divider" };
export type RawHtmlBlock = BlockBase & { type: "raw-html"; html: string; sourceLabel?: string | null };

export type Block = HeadingBlock | TextBlock | ImageBlock | ButtonBlock | DividerBlock | RawHtmlBlock;

export type StructuredContentSnapshot = { version: 1; blocks: Block[] };

export const KNOWN_BLOCK_TYPES = new Set<Block["type"]>(["heading", "text", "image", "button", "divider", "raw-html"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function looksLikeStructuredSnapshot(raw: Record<string, unknown>): raw is { version: 1; blocks: unknown[] } {
  return (
    raw.version === 1 &&
    Array.isArray(raw.blocks) &&
    raw.blocks.every(
      (block) => isRecord(block) && typeof block.id === "string" && typeof block.type === "string" && KNOWN_BLOCK_TYPES.has(block.type as Block["type"])
    )
  );
}

/** Escapes plain text and converts newlines to `<br />`, wrapped in a `<p>`. */
export function textToHtml(text: string): string {
  return `<p>${escapeHtml(text).replaceAll("\n", "<br />")}</p>`;
}

const LINK_URL_SCHEMES = ["http:", "https:", "mailto:"];
const IMAGE_SRC_SCHEMES = ["http:", "https:"];

function isSafeUrl(value: string, allowedSchemes: string[]): boolean {
  try {
    return allowedSchemes.includes(new URL(value, "https://blocks.raring2go.invalid").protocol);
  } catch {
    return false;
  }
}

function fail(index: number, message: string): never {
  throw new Error(`Block at index ${index}: ${message}`);
}

function normalizeVisibleSegmentId(value: unknown, index: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return fail(index, "visibleSegmentId must be a string or null.");
  return value;
}

/**
 * The real trust boundary for a block array arriving as untrusted client JSON
 * (the editor's serialized `blocksJson` hidden field). Every block a server
 * action receives must pass through here before it reaches the domain layer —
 * an unknown block type, a missing required field, or an unsafe URL scheme
 * (e.g. `javascript:`) is rejected outright rather than silently dropped or
 * coerced. Rich-text/raw-HTML fields are validated for shape only here; they
 * still need `sanitizeRichTextHtml` applied by the caller before persisting.
 */
export function validateBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) {
    throw new Error("Blocks payload must be an array.");
  }

  return raw.map((entry, index) => validateBlock(entry, index));
}

function validateBlock(entry: unknown, index: number): Block {
  if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id) {
    return fail(index, "missing a valid id.");
  }

  const id = entry.id;
  const visibleSegmentId = normalizeVisibleSegmentId(entry.visibleSegmentId, index);

  switch (entry.type) {
    case "heading": {
      if (typeof entry.text !== "string" || !entry.text.trim()) return fail(index, "heading requires non-empty text.");
      if (entry.level !== 1 && entry.level !== 2) return fail(index, "heading level must be 1 or 2.");
      return { id, type: "heading", text: entry.text, level: entry.level, visibleSegmentId };
    }
    case "text": {
      if (typeof entry.html !== "string") return fail(index, "text block requires html.");
      return { id, type: "text", html: entry.html, visibleSegmentId };
    }
    case "image": {
      if (typeof entry.src !== "string" || !isSafeUrl(entry.src, IMAGE_SRC_SCHEMES)) {
        return fail(index, "image src must be a valid http(s) URL.");
      }
      if (typeof entry.alt !== "string") return fail(index, "image requires alt text.");
      const href = entry.href;
      if (href != null && (typeof href !== "string" || !isSafeUrl(href, LINK_URL_SCHEMES))) {
        return fail(index, "image href must be a valid http(s)/mailto URL.");
      }
      const fileId = entry.fileId;
      if (fileId != null && typeof fileId !== "string") return fail(index, "image fileId must be a string.");
      return { id, type: "image", src: entry.src, alt: entry.alt, href: href ?? null, fileId: fileId ?? null, visibleSegmentId };
    }
    case "button": {
      if (typeof entry.label !== "string" || !entry.label.trim()) return fail(index, "button requires a non-empty label.");
      if (typeof entry.href !== "string" || !isSafeUrl(entry.href, LINK_URL_SCHEMES)) {
        return fail(index, "button href must be a valid http(s)/mailto URL.");
      }
      return { id, type: "button", label: entry.label, href: entry.href, visibleSegmentId };
    }
    case "divider":
      return { id, type: "divider", visibleSegmentId };
    case "raw-html": {
      if (typeof entry.html !== "string") return fail(index, "raw-html block requires html.");
      const sourceLabel = entry.sourceLabel;
      if (sourceLabel != null && typeof sourceLabel !== "string") return fail(index, "raw-html sourceLabel must be a string.");
      return { id, type: "raw-html", html: entry.html, sourceLabel: sourceLabel ?? null, visibleSegmentId };
    }
    default:
      return fail(index, `unknown block type "${String((entry as { type?: unknown }).type)}".`);
  }
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

export type MergeTagRecipient = { firstName?: string | null; lastName?: string | null };

const MERGE_TAG_PATTERN = /\{\{\s*(firstName|lastName)\s*\}\}/gi;

/**
 * Substitutes {{firstName}}/{{lastName}} tokens with a recipient's own data.
 * A missing field resolves to an empty string rather than a placeholder like
 * "there" - silently blank reads better than a template dropping obvious
 * filler text into a real subject line or body.
 */
export function substituteMergeTags(content: string, recipient: MergeTagRecipient): string {
  return content.replace(MERGE_TAG_PATTERN, (_match, tag: string) => {
    switch (tag.toLowerCase()) {
      case "firstname":
        return recipient.firstName?.trim() ?? "";
      case "lastname":
        return recipient.lastName?.trim() ?? "";
      default:
        return "";
    }
  });
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
