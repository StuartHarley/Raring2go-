// @vitest-environment node
import axe from "axe-core";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const base = process.env.SMOKE_BASE_URL;

/**
 * Smoke and accessibility checks against a running production build. Each critical journey page must answer,
 * carry the per-request CSP, and pass axe-core's automated accessibility rules on its server-rendered HTML
 * (contrast is checked in a real browser, which jsdom cannot do). `pnpm --filter @raring2go/web smoke`.
 */
describe.skipIf(!base)("smoke and accessibility (running build)", () => {
  const journeys = [
    { name: "sign-in", path: "/sign-in" },
    { name: "sign-out", path: "/sign-out" },
    { name: "public area home", path: "/areas/sutton-coldfield" },
    { name: "public what's on", path: "/areas/sutton-coldfield/whats-on" },
    { name: "public offers", path: "/areas/sutton-coldfield/offers" },
    { name: "public activities", path: "/areas/sutton-coldfield/activities" },
    { name: "design system", path: "/design-system" }
  ];

  async function render(path: string) {
    const response = await fetch(`${base}${path}`, { redirect: "manual" });
    return { response, html: await response.text() };
  }

  for (const journey of journeys) {
    it(`${journey.name} answers, is protected by a nonce-based CSP, and has no automated accessibility violations`, async () => {
      const { response, html } = await render(journey.path);
      expect(response.status, journey.path).toBe(200);

      const csp = response.headers.get("content-security-policy") ?? "";
      const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
      expect(nonce, "CSP nonce").toBeTruthy();
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
      // Every script the server emitted carries this response's nonce.
      for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
        if (/type="application\/ld\+json"/.test(tag)) continue;
        expect(tag, tag).toContain(`nonce="${nonce}"`);
      }

      const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
      const results = await axe.run(dom.window.document.documentElement, {
        rules: { "color-contrast": { enabled: false }, "scrollable-region-focusable": { enabled: false } }
      });
      expect(results.violations.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes[0]?.html.slice(0, 120)})`)).toEqual([]);
    });
  }

  it("sends staff pages to sign-in rather than showing them", async () => {
    for (const path of ["/app/finance", "/app/roles", "/app/activity", "/app/finance/accounting"]) {
      const { response, html } = await render(path);
      expect(response.status, path).toBeLessThan(500);
      expect(html).not.toContain("Franchise Royalties");
      expect(html).not.toContain("Recent platform events");
      expect(html).not.toContain("Tax rates and accounting");
    }
  });

  it("answers an unknown page with a 404, not an error", async () => {
    const { response } = await render("/areas/no-such-place-anywhere");
    expect(response.status).toBe(404);
  });

  it("keeps the standard security headers on every response", async () => {
    const { response } = await render("/sign-in");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBeTruthy();
    expect(response.headers.get("strict-transport-security")).toBeTruthy();
    expect(response.headers.get("x-powered-by")).toBeNull();
  });
});
