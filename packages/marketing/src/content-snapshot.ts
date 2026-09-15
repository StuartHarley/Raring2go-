import { randomUUID } from "node:crypto";
import { isRecord, looksLikeStructuredSnapshot, textToHtml, type Block, type StructuredContentSnapshot, type TextBlock } from "./blocks";

function textBlock(text: string): TextBlock {
  return { id: randomUUID(), type: "text", html: textToHtml(text) };
}

/**
 * Upgrades every content-snapshot shape found in the database to the structured
 * block form. Two legacy shapes exist: `{ text }` from the plain compose form,
 * and `{ inheritedBlocks, localOverrides }` from the HQ newsletter factory (where
 * only `localOverrides["local-picks"]` ever reached a real send). Both are folded
 * into a single TextBlock whose rendered HTML/plain-text is byte-for-byte
 * identical to the pre-block-model renderer, so this is a transparent refactor
 * for every campaign already in the database.
 *
 * Server-only (uses node:crypto) — this is why it lives apart from blocks.ts,
 * which is exposed to client components via a package subpath export.
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
