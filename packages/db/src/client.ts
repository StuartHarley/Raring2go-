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
