import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { scanTextForSecrets, shouldScanFile } from "./secrets-scan";
import type { SecretFinding } from "./secrets-scan";

/** Files whose purpose is to contain secret-shaped strings (the scanner's own tests and patterns). */
const ALLOWLIST = new Set(["packages/security/src/secrets-scan.ts", "packages/security/src/config-check.test.ts"]);

const MAX_BYTES = 1_000_000;

/** Scan every file git tracks (including staged) under `root`. Untracked and ignored files, such as a local .env, are not the repository's concern. */
export function scanRepository(root: string): { scanned: number; findings: SecretFinding[] } {
  const tracked = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  const findings: SecretFinding[] = [];
  let scanned = 0;

  for (const file of tracked) {
    if (ALLOWLIST.has(file) || !shouldScanFile(file)) continue;
    const full = join(root, file);
    let size = 0;
    try {
      size = statSync(full).size;
    } catch {
      continue; // listed but deleted in the working tree
    }
    if (size > MAX_BYTES) continue;
    const text = readFileSync(full, "utf8");
    if (text.includes("\u0000")) continue; // binary
    scanned += 1;
    findings.push(...scanTextForSecrets(file, text));
  }

  return { scanned, findings };
}
