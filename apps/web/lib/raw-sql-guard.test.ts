import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A Date passed as a parameter to the raw postgres.js client (`sql\`...\``) works under plain Node
 * but throws inside the Next server, so a route that "passed its tests" stored nothing in the
 * browser (public analytics did exactly this). Raw templates must pass ISO strings with a cast;
 * Date objects belong with drizzle's typed queries.
 */
const root = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("raw SQL parameters", () => {
  it("never interpolates a Date into a postgres.js template", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bsql`([^`]*)`/g)) {
        if (/\$\{\s*new Date\(/.test(match[1]!)) offenders.push(file.replace(root, "apps/web"));
      }
    }
    expect(offenders).toEqual([]);
  });
});
