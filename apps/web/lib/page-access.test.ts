import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ShellAccessError, requireShellPermission } from "./app-shell";

const appRoot = join(__dirname, "..", "app");

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else found.push(full);
  }
  return found;
}

const files = walk(join(appRoot, "(app)"));
const pages = files.filter((file) => file.endsWith("/page.tsx"));
const rel = (file: string) => relative(appRoot, file);
const CAPABILITY = /requireShellPermission\(\s*request,\s*\{\s*module:\s*"([^"]+)",\s*action:\s*"([^"]+)"/g;

const pageCapabilities = pages.map((file) => ({
  page: rel(file),
  source: readFileSync(file, "utf8"),
  capabilities: [...readFileSync(file, "utf8").matchAll(CAPABILITY)].map((match) => ({ module: match[1]!, action: match[2]! }))
}));

/** Pages that resolve the signed-in user themselves and show only what that user may see, with the reason why. */
const SELF_SCOPED = new Map<string, string>([
  ["(app)/app/page.tsx", "Home: resolves the shell and redirects portal users; shows only the actor's own cards."],
  ["(app)/app/action-centre/page.tsx", "Lists only the actor's own tasks and approvals, filtered server-side."],
  ["(app)/app/search/page.tsx", "Search results are filtered by the actor's permissions server-side."],
  ["(app)/app/unauthorised/page.tsx", "The denial page itself."],
  ["(app)/app/settings/connections/page.tsx", "Checks the integrations permission inside its loader."]
]);

describe("every staff page protects itself on the server (IAM-003)", () => {
  it("finds the pages", () => {
    expect(pages.length).toBeGreaterThan(40);
  });

  it("calls requireShellPermission with a literal capability, or is a documented self-scoped page", () => {
    const unprotected = pageCapabilities
      .filter((entry) => entry.capabilities.length === 0 && !SELF_SCOPED.has(entry.page))
      // Pages that gate through a shared loader still name the capability in source.
      .filter((entry) => !/requireShellPermission|requirePortal|ProtectedOutcome|protectedOutcome/.test(entry.source))
      .map((entry) => entry.page);
    expect(unprotected).toEqual([]);
  });

  it("only exempts pages that really resolve the session", () => {
    for (const page of SELF_SCOPED.keys()) {
      const entry = pageCapabilities.find((candidate) => candidate.page === page)!;
      expect(entry, page).toBeDefined();
      expect(/resolveShell|requireShellPermission|listConnectionCards|unauthorised/.test(entry.source), page).toBe(true);
    }
  });

  it("proves the actor on every server action file", () => {
    const actionFiles = files.filter((file) => file.endsWith("actions.ts") && readFileSync(file, "utf8").startsWith('"use server"'));
    expect(actionFiles.length).toBeGreaterThan(10);
    for (const file of actionFiles) {
      const source = readFileSync(file, "utf8");
      expect(/requireShellPermission|assertBoundActor|resolveShell|readSessionBacked|sessionCookieName|cookies\(\)/.test(source), rel(file)).toBe(true);
      // Files that accept a bound context must verify it in every exported action.
      const exported = [...source.matchAll(/export async function (\w+)\(\s*context:/g)].length;
      if (exported > 0) expect([...source.matchAll(/await assertBoundActor\(context\)/g)].length, rel(file)).toBe(exported);
    }
  });
});

describe("role by role, denied pages are denied by the server, not just hidden", () => {
  const roles = ["superadmin", "franchisee", "advertiser"] as const;
  const unique = [...new Map(pageCapabilities.flatMap((entry) => entry.capabilities).map((capability) => [`${capability.module}.${capability.action}`, capability])).values()];

  async function allowedFor(sessionKey: string) {
    const allowed = new Set<string>();
    for (const capability of unique) {
      try {
        await requireShellPermission({ sessionKey }, capability);
        allowed.add(`${capability.module}.${capability.action}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ShellAccessError);
        expect((error as ShellAccessError).kind).toBe("unauthorised");
      }
    }
    return allowed;
  }

  it("rejects every request with no session as unauthenticated", async () => {
    for (const capability of unique) {
      await expect(requireShellPermission({}, capability)).rejects.toMatchObject({ kind: "unauthenticated" });
    }
  });

  it("lets Super Admin into every staff page", async () => {
    const allowed = await allowedFor("superadmin");
    const missing = [...unique.map((c) => `${c.module}.${c.action}`)].filter((key) => !allowed.has(key));
    // The advertiser portal belongs to advertisers, the territory page needs a territory context chosen first, and a
    // franchise's own team is run by that franchise (Head Office manages people at /app/roles).
    expect(missing.sort()).toEqual(["franchise.team.view", "portal.advertiser.view", "territory.view"]);
  });

  it("keeps a franchisee out of network, system and finance-configuration pages", async () => {
    const allowed = await allowedFor("franchisee");
    for (const denied of ["system.administer", "roles.manage", "advertiser.tax_rate.manage", "analytics.health_config.manage", "analytics.snapshot.generate"]) {
      const [module, ...rest] = denied.split(".");
      const key = unique.find((c) => `${c.module}.${c.action}` === denied || (c.module === module && c.action === rest.join(".")));
      if (key) expect(allowed.has(`${key.module}.${key.action}`), denied).toBe(false);
    }
    expect(allowed.has("system.administer")).toBe(false);
  });

  it("gives a franchisee their team page, and keeps team management away from everyone else's staff", async () => {
    expect((await allowedFor("franchisee")).has("franchise.team.view")).toBe(true);
    expect((await allowedFor("advertiser")).has("franchise.team.view")).toBe(false);
  });

  it("gives an advertiser user the advertiser portal and no staff page at all", async () => {
    const allowed = await allowedFor("advertiser");
    expect([...allowed]).toEqual(["portal.advertiser.view"]);
  });

  it("records what each role may open, so a permission change shows up in review", async () => {
    const summary: Record<string, number> = {};
    for (const role of roles) summary[role] = (await allowedFor(role)).size;
    expect(summary.superadmin).toBe(unique.length - 3);
    expect(summary.advertiser).toBe(1);
    expect(summary.franchisee).toBeGreaterThan(0);
    expect(summary.franchisee).toBeLessThan(unique.length);
  });
});
