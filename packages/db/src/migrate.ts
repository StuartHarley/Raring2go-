import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, requireMigrationDatabaseUrl } from "./client";

async function main() {
  const { db, sql } = createDb(requireMigrationDatabaseUrl());

  try {
    await migrate(db, {
      migrationsFolder: "migrations"
    });
  } finally {
    await sql.end();
  }
}

void main();
