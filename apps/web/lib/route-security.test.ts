// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { protectionMarkers, routeManifest } from "./route-security";

const appDir = join(import.meta.dirname, "..", "app");

function findRoutes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return findRoutes(full);
    return /^route\.(ts|tsx|js)$/.test(name) ? [relative(appDir, full)] : [];
  });
}

const routes = findRoutes(appDir).sort();
const read = (route: string) => readFileSync(join(appDir, route), "utf8");

describe("route security inventory", () => {
  it("lists every route handler, so no endpoint ships without a decision about who may call it", () => {
    expect(routes).toEqual(Object.keys(routeManifest).sort());
  });

  it("shows, in each route's source, the protection the manifest claims", () => {
    for (const route of routes) {
      const entry = routeManifest[route]!;
      const source = read(route);
      for (const marker of [...protectionMarkers[entry.protection], ...(entry.extraMarkers ?? [])]) {
        expect(source, `${route} (${entry.protection}) should match ${marker}`).toMatch(marker);
      }
    }
  });

  it("gives every public endpoint a rate limit or no data access at all", () => {
    for (const route of routes) {
      const entry = routeManifest[route]!;
      const source = read(route);
      if (entry.protection === "public_static") expect(source, `${route} must not touch the database`).not.toMatch(/createDb\(/);
      if (entry.protection === "public_rate_limited") expect(source, route).toMatch(/firstRateLimitRefusal\(/);
    }
  });

  it("never enables cross-origin access from any origin", () => {
    for (const route of routes) expect(read(route), route).not.toMatch(/Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*/i);
  });

  it("does not leave a hand-rolled cron check that could drift from the shared fail-closed one", () => {
    for (const route of routes) {
      expect(read(route), route).not.toMatch(/APP_ENV\s*!==\s*"production"/);
      expect(read(route), route).not.toMatch(/function isAuthorizedCronRequest/);
    }
  });

  it("never exposes a destructive action over GET, where a link or image tag could trigger it", () => {
    for (const route of routes.filter((candidate) => /revoke|delete|remove|disconnect|erase/.test(candidate))) {
      expect(read(route), route).not.toMatch(/export async function GET/);
    }
  });
});
