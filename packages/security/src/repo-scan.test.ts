import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scanRepository } from "./repo-scan";

describe("repository secret scan", () => {
  it("finds no credentials in any tracked file", () => {
    const { scanned, findings } = scanRepository(resolve(import.meta.dirname, "../../.."));
    expect(scanned).toBeGreaterThan(100);
    expect(findings).toEqual([]);
  });
});
