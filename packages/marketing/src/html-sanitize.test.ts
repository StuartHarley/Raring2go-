import { describe, expect, it } from "vitest";
import { sanitizeImportedHtml, sanitizeRichTextHtml } from "./html-sanitize";

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

describe("sanitizeImportedHtml", () => {
  it("keeps block-level structure, tables and images a real newsletter uses", () => {
    const html =
      '<h1>Half term ideas</h1><div><table><tbody><tr><td><img src="https://example.test/a.png" alt="Picnic" width="200" /></td><td><h2>Picnic in the park</h2><p>Bring a blanket!</p></td></tr></tbody></table></div>';
    expect(sanitizeImportedHtml(html)).toBe(html);
  });

  it("keeps a conservative set of presentational inline styles", () => {
    const html = '<p style="color: #333333; text-align: center; font-weight: bold;">Styled text</p>';
    const result = sanitizeImportedHtml(html);
    expect(result).toContain("color:#333333");
    expect(result).toContain("text-align:center");
    expect(result).toContain("font-weight:bold");
  });

  it("strips style properties that can carry a url(...) value", () => {
    const html = '<div style="background-image: url(javascript:alert(1)); color: red;">Hi</div>';
    const result = sanitizeImportedHtml(html);
    expect(result).not.toContain("background-image");
    expect(result).not.toContain("javascript:");
    expect(result).toContain("color");
  });

  it("strips script tags, iframes and event handlers from imported HTML", () => {
    const html = '<h1 onclick="alert(1)">Hi</h1><script>alert("xss")</script><iframe src="https://evil.test"></iframe>';
    const result = sanitizeImportedHtml(html);
    expect(result).not.toContain("<script");
    expect(result).not.toContain("<iframe");
    expect(result).not.toContain("onclick");
  });

  it("strips a javascript: image src", () => {
    const html = '<img src="javascript:alert(1)" alt="bad" />';
    const result = sanitizeImportedHtml(html);
    expect(result).not.toContain("javascript:");
  });

  it("strips a data: image src (only http/https allowed)", () => {
    const html = '<img src="data:text/html,<script>alert(1)</script>" alt="bad" />';
    const result = sanitizeImportedHtml(html);
    expect(result).not.toContain("data:");
    expect(result).not.toContain("<script");
  });

  it("adds safe rel/target to links inside imported HTML too", () => {
    const html = '<p><a href="https://example.test">Visit</a></p>';
    const result = sanitizeImportedHtml(html);
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('target="_blank"');
  });
});
