import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapProduction } from "./bootstrap";
import { createDb, requireDatabaseUrl } from "./client";
import { fixtureIds } from "./fixtures";
import { advertisers, audienceContacts, franchises, permissions, territories, userRoleAssignments, users } from "./schema";

/** Runs the production bootstrap against a throwaway database made on the same server, so nothing shared is touched. `RUN_DB_TESTS=1` */
describe.skipIf(!process.env.RUN_DB_TESTS)("production bootstrap (postgres)", () => {
  const name = `r2g_boot_${randomUUID().slice(0, 8)}`;
  const base = new URL(requireDatabaseUrl());
  const admin = postgres(base.toString(), { max: 1 });
  const scratch = new URL(base.toString());
  scratch.pathname = `/${name}`;
  const url = scratch.toString();

  beforeAll(async () => {
    await admin.unsafe(`create database ${name}`);
    const { db, sql } = createDb(url);
    try {
      await migrate(db, { migrationsFolder: "migrations" });
    } finally {
      await sql.end();
    }
  }, 120_000);

  afterAll(async () => {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.end();
  });

  const read = async <T>(fn: (db: ReturnType<typeof createDb>["db"]) => Promise<T>) => {
    const { db, sql } = createDb(url);
    try {
      return await fn(db);
    } finally {
      await sql.end();
    }
  };

  it("sets up reference data and one real admin, and no demo data", async () => {
    const result = await bootstrapProduction({ adminEmail: "Stuart@ComputerXplorers.co.uk", adminName: "Stuart", databaseUrl: url });
    expect(result).toMatchObject({ adminCreated: true, adminEmail: "stuart@computerxplorers.co.uk" });
    expect(result.permissions).toBeGreaterThan(100);

    const state = await read(async (db) => ({
      users: await db.select({ email: users.email }).from(users),
      assignments: await db.select().from(userRoleAssignments),
      permissions: await db.select().from(permissions),
      territories: await db.select().from(territories),
      franchises: await db.select().from(franchises),
      advertisers: await db.select().from(advertisers),
      contacts: await db.select().from(audienceContacts)
    }));
    expect(state.users.map((user) => user.email).sort()).toEqual(["stuart@computerxplorers.co.uk", "workflow-automation@system.raring2go.test"]);
    expect(state.assignments.filter((a) => a.roleId === fixtureIds.roles.superAdmin)).toHaveLength(1);
    expect([state.territories, state.franchises, state.advertisers, state.contacts].map((rows) => rows.length)).toEqual([0, 0, 0, 0]);
  }, 60_000);

  it("is safe to repeat, picks up a missing permission, and refuses a different admin once users exist", async () => {
    const before = await read((db) => db.select().from(permissions));
    await read(async (db) => {
      const { eq } = await import("drizzle-orm");
      await db.delete(permissions).where(eq(permissions.id, fixtureIds.permissions.franchiseImportManage));
    });
    const again = await bootstrapProduction({ databaseUrl: url });
    expect(again.adminCreated).toBe(false);
    expect((await read((db) => db.select().from(permissions))).length).toBe(before.length);
    expect(await bootstrapProduction({ adminEmail: "stuart@computerxplorers.co.uk", databaseUrl: url })).toMatchObject({ adminCreated: false });
    await expect(bootstrapProduction({ adminEmail: "someone.else@example.com", databaseUrl: url })).rejects.toThrow(/already has other users/);
    expect((await read((db) => db.select().from(users))).length).toBe(2);
  }, 60_000);

  it("rejects invalid or placeholder admin addresses before touching anything", async () => {
    await expect(bootstrapProduction({ adminEmail: "nope", databaseUrl: url })).rejects.toThrow(/valid address/);
    await expect(bootstrapProduction({ adminEmail: "admin@example.raring2go.test", databaseUrl: url })).rejects.toThrow(/real address/);
  });
});
