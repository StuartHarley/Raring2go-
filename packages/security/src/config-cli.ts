import { checkSecurityConfig } from "./config-check";

/** Pre-deploy check: run with the production environment loaded, e.g. `vercel env pull` then `pnpm security:config`. */
const findings = checkSecurityConfig(process.env);
const errors = findings.filter((finding) => finding.severity === "error");

for (const finding of findings) console.log(`${finding.severity.toUpperCase().padEnd(7)} ${finding.code}: ${finding.message}`);

if (errors.length) {
  console.error(`\n${errors.length} blocking security configuration error(s). Do not deploy.`);
  process.exit(1);
}

const production = process.env.APP_ENV === "production" || process.env.APP_ENV === "preview" || process.env.NODE_ENV === "production";
console.log(production ? "\nNo blocking security configuration errors." : "\nAPP_ENV is not production or preview, so no production checks were applied.");
