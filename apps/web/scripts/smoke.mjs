// Starts the production server on a spare port, runs the smoke and accessibility checks against it, and stops it.
// Needs a completed `next build`. Usage: pnpm --filter @raring2go/web smoke
import { spawn } from "node:child_process";

const port = process.env.SMOKE_PORT ?? "3199";
const base = `http://127.0.0.1:${port}`;
const server = spawn("pnpm", ["exec", "next", "start", "-p", port, "-H", "127.0.0.1"], { stdio: ["ignore", "inherit", "inherit"] });
let finished = false;
const stop = () => { if (!finished) { finished = true; server.kill("SIGTERM"); } };
process.on("exit", stop);
process.on("SIGINT", () => { stop(); process.exit(130); });

async function waitUntilReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/sign-in`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The server did not start in time.");
}

try {
  await waitUntilReady();
  const tests = spawn("pnpm", ["exec", "vitest", "run", "smoke/"], { stdio: "inherit", env: { ...process.env, SMOKE_BASE_URL: base } });
  const code = await new Promise((resolve) => tests.on("exit", resolve));
  stop();
  process.exit(code ?? 1);
} catch (error) {
  console.error(error);
  stop();
  process.exit(1);
}
