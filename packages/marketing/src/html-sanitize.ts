import sanitizeHtml from "sanitize-html";

const RICH_TEXT_TAGS = ["p", "br", "strong", "em", "a", "ul", "ol", "li"];

const LINK_TRANSFORM = {
  a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" })
};

const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: RICH_TEXT_TAGS,
  allowedAttributes: {
    a: ["href", "rel", "target"]
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: LINK_TRANSFORM
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

// A conservative subset of presentational CSS properties, safe to keep from
// imported HTML. Deliberately excludes anything that takes a url(...) value
// (background, background-image, list-style-image, cursor, content, etc.) —
// those are a real javascript:/data: smuggling vector via CSS and are simply
// dropped rather than value-validated.
const SAFE_CSS_VALUE = /^[^;]+$/;
const IMPORT_ALLOWED_STYLES: sanitizeHtml.IOptions["allowedStyles"] = {
  "*": {
    color: [SAFE_CSS_VALUE],
    "background-color": [SAFE_CSS_VALUE],
    "font-size": [SAFE_CSS_VALUE],
    "font-weight": [SAFE_CSS_VALUE],
    "font-style": [SAFE_CSS_VALUE],
    "text-align": [SAFE_CSS_VALUE],
    "text-decoration": [SAFE_CSS_VALUE],
    padding: [SAFE_CSS_VALUE],
    margin: [SAFE_CSS_VALUE],
    border: [SAFE_CSS_VALUE],
    "border-radius": [SAFE_CSS_VALUE],
    width: [SAFE_CSS_VALUE],
    "line-height": [SAFE_CSS_VALUE]
  }
};

const IMPORT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...RICH_TEXT_TAGS, "h1", "h2", "h3", "div", "span", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "img"],
  allowedAttributes: {
    a: ["href", "rel", "target", "style"],
    img: ["src", "alt", "width", "height"],
    "*": ["style"]
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowedStyles: IMPORT_ALLOWED_STYLES,
  transformTags: LINK_TRANSFORM
};

/**
 * Sanitizes a whole pasted/uploaded HTML document (or fragment) for the "HTML
 * import" affordance. A wider allowlist than sanitizeRichTextHtml — imported
 * newsletters have real block-level structure (headings, layout tables,
 * images) a single paragraph doesn't — but the same hard rule applies:
 * <script>/<iframe>/event-handler attributes and any javascript:/data: URL
 * are stripped, never escaped-and-kept. Called server-side only; the import
 * affordance may also read the file client-side, but that is never treated
 * as the trust boundary.
 */
export function sanitizeImportedHtml(html: string): string {
  return sanitizeHtml(html, IMPORT_OPTIONS).trim();
}
