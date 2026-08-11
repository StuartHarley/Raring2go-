import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function loadLocalEnv() {
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

export function requireDatabaseUrl(source = process.env) {
  loadLocalEnv();
  const url = source.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is required for database operations.");
  }

  assertPostgresUrl(url, "DATABASE_URL");

  return url;
}

export function requireMigrationDatabaseUrl(source = process.env) {
  loadLocalEnv();
  const url = source.DATABASE_MIGRATION_URL ?? source.DATABASE_DIRECT_URL ?? source.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is required for database migrations.");
  }

  assertPostgresUrl(url, source.DATABASE_MIGRATION_URL
    ? "DATABASE_MIGRATION_URL"
    : source.DATABASE_DIRECT_URL
      ? "DATABASE_DIRECT_URL"
      : "DATABASE_URL");

  return url;
}

export function createSqlClient(databaseUrl = requireDatabaseUrl()) {
  return postgres(databaseUrl, {
    max: 1,
    prepare: false
  });
}

export function createDb(databaseUrl = requireDatabaseUrl()) {
  const sql = createSqlClient(databaseUrl);

  return {
    db: drizzle(sql, { schema }),
    sql
  };
}

function assertPostgresUrl(value: string, label: string) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL connection URL.`);
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`${label} must use the postgres or postgresql protocol.`);
  }

  if (!parsed.hostname) {
    throw new Error(`${label} must include a database host.`);
  }
}
