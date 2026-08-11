import { describe, expect, it } from "vitest";
import { requireDatabaseUrl, requireMigrationDatabaseUrl } from "./client";

describe("database URL handling", () => {
  it("accepts Neon-compatible Postgres URLs", () => {
    const url = "postgresql://user:password@ep-example-pooler.eu-west-2.aws.neon.tech/raring2go?sslmode=require";

    expect(requireDatabaseUrl({ DATABASE_URL: url } as NodeJS.ProcessEnv)).toBe(url);
  });

  it("fails clearly for missing or invalid database URLs", () => {
    expect(() => requireDatabaseUrl({} as NodeJS.ProcessEnv)).toThrow("DATABASE_URL is required");
    expect(() => requireDatabaseUrl({ DATABASE_URL: "not-a-url" } as NodeJS.ProcessEnv)).toThrow("valid PostgreSQL");
    expect(() => requireDatabaseUrl({ DATABASE_URL: "mysql://user:password@example.com/db" } as NodeJS.ProcessEnv)).toThrow("postgres");
  });

  it("prefers direct/admin migration URLs over pooled runtime URLs", () => {
    const runtimeUrl = "postgresql://runtime:password@ep-example-pooler.eu-west-2.aws.neon.tech/raring2go?sslmode=require";
    const directUrl = "postgresql://migration:password@ep-example.eu-west-2.aws.neon.tech/raring2go?sslmode=require";

    expect(requireMigrationDatabaseUrl({
      DATABASE_URL: runtimeUrl,
      DATABASE_DIRECT_URL: directUrl
    } as NodeJS.ProcessEnv)).toBe(directUrl);
    expect(requireMigrationDatabaseUrl({
      DATABASE_URL: runtimeUrl,
      DATABASE_MIGRATION_URL: directUrl
    } as NodeJS.ProcessEnv)).toBe(directUrl);
  });
});
