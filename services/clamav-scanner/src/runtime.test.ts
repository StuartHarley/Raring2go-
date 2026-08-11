import { join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("compiled scanner service runtime", () => {
  it("loads the emitted ESM server module with Node", async () => {
    const outDir = join(import.meta.dirname, "..", ".runtime-test-dist");

    try {
      await run("pnpm", [
        "--filter",
        "@raring2go/clamav-scanner",
        "exec",
        "tsc",
        "--noEmit",
        "false",
        "--outDir",
        outDir
      ]);
      await run("node", [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(`${outDir}/server.js`)})`
      ]);
    } finally {
      await run("node", [
        "--input-type=module",
        "-e",
        `await import("node:fs/promises").then(({ rm }) => rm(${JSON.stringify(outDir)}, { recursive: true, force: true }))`
      ]);
    }
  });
});

async function run(command: string, args: string[]) {
  const result = await new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve) => {
    const child = spawn(command, args, {
      cwd: join(import.meta.dirname, ".."),
      env: {
        ...process.env,
        SCANNER_API_KEY: "runtime-test",
        R2_ACCOUNT_ID: "account",
        R2_BUCKET: "bucket",
        R2_ACCESS_KEY_ID: "access",
        R2_SECRET_ACCESS_KEY: "secret"
      }
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolve({ code, stderr, stdout }));
  });

  expect(result, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`).toMatchObject({ code: 0 });
}
