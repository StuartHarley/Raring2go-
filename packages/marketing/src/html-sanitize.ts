import sanitizeHtml from "sanitize-html";

const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "a", "ul", "ol", "li"],
  allowedAttributes: {
    a: ["href", "rel", "target"]
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" })
  }
};

/**
 * Sanitizes rich text produced by the block editor's inline (Tiptap) editing
 * surface. Client-side sanitization never happens here — this is the real
 * trust boundary a server action must call before persisting a TextBlock's
 * `html`, since the client that produced it is never trusted (AGENTS.md:
 * "Hiding a button is never security").
 */
export function sanitizeRichTextHtml(html: string): string {
  return sanitizeHtml(html, RICH_TEXT_OPTIONS).trim();
}
