import { describe, expect, it } from "vitest";
import { sanitizeRichTextHtml } from "./html-sanitize";

describe("sanitizeRichTextHtml", () => {
  it("keeps allowed formatting tags", () => {
    const html = "<p>Hello <strong>world</strong>, <em>welcome</em>.</p><ul><li>One</li><li>Two</li></ul>";
    expect(sanitizeRichTextHtml(html)).toBe(html);
  });

  it("strips script tags entirely", () => {
    const html = '<p>Hello</p><script>alert("xss")</script>';
    const result = sanitizeRichTextHtml(html);
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
  });

  it("strips event-handler attributes", () => {
    const html = '<p onclick="alert(1)">Click me</p>';
    const result = sanitizeRichTextHtml(html);
    expect(result).not.toContain("onclick");
  });

  it("strips a javascript: link href", () => {
    const html = '<p><a href="javascript:alert(1)">Click</a></p>';
    const result = sanitizeRichTextHtml(html);
    expect(result).not.toContain("javascript:");
  });

  it("keeps a real link and adds safe rel/target", () => {
    const html = '<p><a href="https://example.test">Visit</a></p>';
    const result = sanitizeRichTextHtml(html);
    expect(result).toContain('href="https://example.test"');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('target="_blank"');
  });

  it("drops disallowed block-level tags like iframe and img", () => {
    const html = '<iframe src="https://evil.test"></iframe><img src="x.png" onerror="alert(1)" />';
    const result = sanitizeRichTextHtml(html);
    expect(result).not.toContain("<iframe");
    expect(result).not.toContain("<img");
  });
});
