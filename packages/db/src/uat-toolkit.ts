import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql as drizzleSql } from "drizzle-orm";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDb, requireDatabaseUrl, requireMigrationDatabaseUrl } from "./client";
import { seedUatDatabase } from "./seed-uat";
import { memberships, organisations, permissions, roles, userRoleAssignments, users } from "./schema";

type Status = "GREEN" | "AMBER" | "RED";

type Check = {
  status: Status;
  label: string;
  detail: string;
  action?: string;
};

const command = process.argv[2] ?? "check";

hydrateLocalEnv();

if (command === "check") {
  await runCheck();
} else if (command === "db:setup") {
  await runDbSetup();
} else if (command === "smoke") {
  await runSmoke();
} else {
  console.error(`Unsupported UAT toolkit command: ${command}`);
  process.exit(1);
}

async function runCheck() {
  const checks: Check[] = [
    ...environmentChecks(),
    ...providerPresenceChecks()
  ];

  checks.push(await databaseConnectivityCheck());

  printReport("UAT readiness check", checks, remainingActions(checks));
  exitFor(checks);
}

async function runDbSetup() {
  const checks: Check[] = [...safetyChecks()];

  if (hasRed(checks)) {
    printReport("UAT database setup", checks, remainingActions(checks));
    process.exit(1);
  }

  const migrationUrl = requireMigrationDatabaseUrl();
  const { db, sql } = createDb(migrationUrl);

  try {
    await migrate(db, { migrationsFolder: "migrations" });
    checks.push({
      status: "GREEN",
      label: "Migrations",
      detail: "Committed migrations applied successfully."
    });
  } finally {
    await sql.end();
  }

  await seedUatDatabase();
  checks.push({
    status: "GREEN",
    label: "Minimal UAT seed",
    detail: "Minimal UAT seed completed idempotently."
  });

  checks.push(...await databaseStateChecks());

  printReport("UAT database setup", checks, remainingActions(checks));
  exitFor(checks);
}

async function runSmoke() {
  const checks: Check[] = [
    ...safetyChecks(),
    routeConfigCheck("APP_URL", process.env.APP_URL, "/sign-in"),
    routeConfigCheck("NEXT_PUBLIC_SITE_URL", process.env.NEXT_PUBLIC_SITE_URL, publicSmokePath())
  ];

  if (!hasRed(checks)) {
    checks.push(await routeFetchCheck("App sign-in route", process.env.APP_URL, "/sign-in"));
    checks.push(await routeFetchCheck("Public UAT route", process.env.NEXT_PUBLIC_SITE_URL, publicSmokePath()));
  }

  printReport("UAT smoke check", checks, remainingActions(checks));
  exitFor(checks);
}

function environmentChecks(): Check[] {
  return [
    ...safetyChecks(),
    required("DATABASE_URL", true, "Neon pooled runtime database URL."),
    optional("DATABASE_MIGRATION_URL", true, "Recommended Neon direct URL for migrations."),
    required("UAT_ADMIN_EMAIL", false, "Passwordless UAT admin email."),
    optional("UAT_ADMIN_NAME", false, "UAT admin display name."),
    required("APP_URL", false, "Internal app URL."),
    required("NEXT_PUBLIC_SITE_URL", false, "Public UAT site URL.")
  ];
}

function safetyChecks(): Check[] {
  const appEnv = process.env.APP_ENV;
  const confirmation = process.env.UAT_CONFIRMATION;
  const checks: Check[] = [];

  if (appEnv === "preview" || confirmation === "RARING2GO_UAT") {
    checks.push({
      status: "GREEN",
      label: "UAT confirmation",
      detail: appEnv === "preview"
        ? "APP_ENV=preview."
        : "Explicit UAT confirmation supplied."
    });
  } else {
    checks.push({
      status: "RED",
      label: "UAT confirmation",
      detail: "Refusing UAT operation without APP_ENV=preview or UAT_CONFIRMATION=RARING2GO_UAT.",
      action: "Set APP_ENV=preview for Neon UAT, or set UAT_CONFIRMATION=RARING2GO_UAT for an approved non-preview UAT run."
    });
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && looksLikeProductionDatabase(databaseUrl)) {
    checks.push({
      status: "RED",
      label: "Database target safety",
      detail: "DATABASE_URL appears to reference a production/main database.",
      action: "Point DATABASE_URL at the Neon UAT/preview branch before running UAT setup."
    });
  } else if (databaseUrl) {
    checks.push({
      status: "GREEN",
      label: "Database target safety",
      detail: "DATABASE_URL does not match obvious production/main markers."
    });
  }

  return checks;
}

function providerPresenceChecks(): Check[] {
  return [
    provider("Postmark", ["EMAIL_PROVIDER", "EMAIL_FROM", "POSTMARK_SERVER_TOKEN", "POSTMARK_TRANSACTIONAL_STREAM", "POSTMARK_BROADCAST_STREAM", "POSTMARK_WEBHOOK_SECRET"]),
    provider("SecretStore", ["INTEGRATION_SECRET_ENCRYPTION_KEY", "INTEGRATION_SECRET_KEY_VERSION"]),
    provider("Meta", ["SOCIAL_PROVIDER", "META_APP_ID", "META_APP_SECRET", "META_OAUTH_REDIRECT_URI", "META_OAUTH_SCOPES", "META_GRAPH_API_VERSION"]),
    provider("R2", ["STORAGE_PROVIDER", "R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "STORAGE_URL_TTL_SECONDS"]),
    provider("ClamAV scanner", ["SCANNER_PROVIDER", "CLAMAV_SCANNER_ENDPOINT", "CLAMAV_SCANNER_API_KEY"])
  ];
}

async function databaseConnectivityCheck(): Promise<Check> {
  try {
    const { sql } = createDb(requireDatabaseUrl());
    try {
      await sql`select 1`;
      return {
        status: "GREEN",
        label: "Neon connectivity",
        detail: "Database connection succeeded."
      };
    } finally {
      await sql.end();
    }
  } catch (error) {
    return {
      status: "RED",
      label: "Neon connectivity",
      detail: errorMessage(error),
      action: "Check DATABASE_URL, network access and Neon branch state."
    };
  }
}

async function databaseStateChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const { db, sql } = createDb();

  try {
    const tableRows = await sql<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('users', 'organisations', 'memberships', 'roles', 'permissions', 'role_permissions', 'user_role_assignments')
    `;
    const tableNames = new Set(tableRows.map((row) => row.table_name));
    const expectedTables = ["users", "organisations", "memberships", "roles", "permissions", "role_permissions", "user_role_assignments"];
    const missingTables = expectedTables.filter((table) => !tableNames.has(table));

    checks.push({
      status: missingTables.length ? "RED" : "GREEN",
      label: "Expected tables",
      detail: missingTables.length
        ? `Missing tables: ${missingTables.join(", ")}.`
        : "Minimum auth/RBAC tables are present.",
      action: missingTables.length ? "Run migrations against the Neon UAT database." : undefined
    });

    const migrationRows = await sql<{ count: string }[]>`
      select count(*)::text as count
      from drizzle.__drizzle_migrations
    `.catch(() => [{ count: "0" }]);

    checks.push({
      status: Number(migrationRows[0]?.count ?? 0) > 0 ? "GREEN" : "RED",
      label: "Migration state",
      detail: `${migrationRows[0]?.count ?? "0"} Drizzle migration records found.`,
      action: Number(migrationRows[0]?.count ?? 0) > 0 ? undefined : "Run pnpm db:migrate or pnpm uat:db:setup."
    });

    const adminEmail = process.env.UAT_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
    const matchingUsers = await db.select({ id: users.id }).from(users).where(eq(users.email, adminEmail));
    const hqRows = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.kind, "hq"));
    const membershipRows = matchingUsers[0]
      ? await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, matchingUsers[0].id))
      : [];
    const roleRows = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, "uat-super-admin"));
    const permissionRows = await db.select({ count: drizzleSql<string>`count(*)::text` }).from(permissions);
    const assignmentRows = matchingUsers[0]
      ? await db.select({ id: userRoleAssignments.id }).from(userRoleAssignments).where(eq(userRoleAssignments.userId, matchingUsers[0].id))
      : [];

    checks.push({
      status: matchingUsers.length && hqRows.length && membershipRows.length && roleRows.length && Number(permissionRows[0]?.count ?? 0) > 0 && assignmentRows.length
        ? "GREEN"
        : "RED",
      label: "UAT admin account",
      detail: matchingUsers.length
        ? "UAT admin user, organisation membership and role assignment verified."
        : "UAT admin user was not found.",
      action: matchingUsers.length ? undefined : "Run pnpm uat:db:setup with UAT_ADMIN_EMAIL set."
    });
  } catch (error) {
    checks.push({
      status: "RED",
      label: "Database state",
      detail: errorMessage(error),
      action: "Review migrations and minimal UAT seed output."
    });
  } finally {
    await sql.end();
  }

  return checks;
}

function required(name: string, secret: boolean, purpose: string): Check {
  if (process.env[name]) {
    return {
      status: "GREEN",
      label: name,
      detail: `${purpose} Configured${secret ? " (secret hidden)." : "."}`
    };
  }

  return {
    status: "RED",
    label: name,
    detail: `${purpose} Missing.`,
    action: `Set ${name} in the UAT environment.`
  };
}

function optional(name: string, secret: boolean, purpose: string): Check {
  if (process.env[name]) {
    return {
      status: "GREEN",
      label: name,
      detail: `${purpose} Configured${secret ? " (secret hidden)." : "."}`
    };
  }

  return {
    status: "AMBER",
    label: name,
    detail: `${purpose} Not configured.`,
    action: `Configure ${name} if this UAT environment will run migrations/admin tasks.`
  };
}

function provider(label: string, names: string[]): Check {
  const missing = names.filter((name) => !process.env[name]);

  if (!missing.length) {
    return {
      status: "GREEN",
      label,
      detail: "Configuration variables are present. No provider call was made."
    };
  }

  return {
    status: "AMBER",
    label,
    detail: `Missing: ${missing.join(", ")}. No provider call was made.`,
    action: `Add the missing ${label} variables when live verification is required.`
  };
}

function routeConfigCheck(label: string, baseUrl: string | undefined, path: string): Check {
  if (!baseUrl) {
    return {
      status: "RED",
      label,
      detail: "Base URL is missing.",
      action: `Set ${label}.`
    };
  }

  try {
    const url = new URL(path, baseUrl);
    return {
      status: "GREEN",
      label,
      detail: `Route configured: ${redactUrl(url)}.`
    };
  } catch {
    return {
      status: "RED",
      label,
      detail: "Base URL is invalid.",
      action: `Set ${label} to a valid absolute URL.`
    };
  }
}

async function routeFetchCheck(label: string, baseUrl: string | undefined, path: string): Promise<Check> {
  if (!baseUrl) {
    return {
      status: "RED",
      label,
      detail: "Base URL is missing."
    };
  }

  const url = new URL(path, baseUrl);

  try {
    const response = await fetch(url, { method: "GET", redirect: "manual" });
    const ok = response.status >= 200 && response.status < 400;

    return {
      status: ok ? "GREEN" : "AMBER",
      label,
      detail: `${redactUrl(url)} returned HTTP ${response.status}.`,
      action: ok ? undefined : "Deploy the app and check route/domain configuration."
    };
  } catch (error) {
    return {
      status: "AMBER",
      label,
      detail: `Could not fetch ${redactUrl(url)}: ${errorMessage(error)}.`,
      action: "Run again from an environment with network access to the deployed UAT app."
    };
  }
}

function publicSmokePath() {
  const slug = process.env.UAT_SMOKE_TERRITORY_SLUG;
  return slug ? `/areas/${encodeURIComponent(slug)}` : "/";
}

function looksLikeProductionDatabase(value: string) {
  const parsed = new URL(value);
  const marker = `${parsed.hostname} ${parsed.pathname} ${parsed.search}`.toLowerCase();
  return /\b(prod|production|main)\b/.test(marker) || marker.includes("branch=main");
}

function printReport(title: string, checks: Check[], actions: string[]) {
  console.info(`\n${title}`);
  console.info("=".repeat(title.length));

  for (const status of ["RED", "AMBER", "GREEN"] satisfies Status[]) {
    for (const check of checks.filter((candidate) => candidate.status === status)) {
      console.info(`${check.status}  ${check.label}: ${check.detail}`);
    }
  }

  console.info("\nRemaining manual actions");
  if (actions.length) {
    for (const action of actions) {
      console.info(`- ${action}`);
    }
  } else {
    console.info("- None from this toolkit. Continue live verification evidence capture.");
  }
}

function remainingActions(checks: Check[]) {
  return [...new Set(checks.map((check) => check.action).filter(Boolean) as string[])];
}

function hasRed(checks: Check[]) {
  return checks.some((check) => check.status === "RED");
}

function exitFor(checks: Check[]) {
  if (hasRed(checks)) {
    process.exit(1);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function redactUrl(url: URL) {
  const copy = new URL(url.toString());
  copy.username = copy.username ? "hidden" : "";
  copy.password = copy.password ? "hidden" : "";
  return copy.toString();
}

function hydrateLocalEnv() {
  const envPath = resolve(process.cwd(), "../../.env");

  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex);
    const value = trimmed.slice(separatorIndex + 1);
    process.env[key] ??= value;
  }
}
