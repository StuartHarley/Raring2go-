import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import { fixtureIds } from "./fixtures";
import { rolePermissions } from "./schema";
import { seedDatabase } from "./seed";
import { seedUatDatabase } from "./seed-uat";

describe("UAT seed policy", () => {
  it("requires an explicit UAT admin email", async () => {
    await expect(seedUatDatabase("postgres://unused", {} as NodeJS.ProcessEnv))
      .rejects
      .toThrow("UAT_ADMIN_EMAIL");
  });

  it("runs after the foundation seed without colliding on shared permissions", async () => {
    // db:seed already creates system.administer / roles.view / integrations.view
    // rows under the foundation fixture ids - seedUatDatabase must reuse those,
    // not mint its own and collide on the real (module, action) unique index.
    await seedDatabase();
    const result = await seedUatDatabase(undefined, {
      UAT_ADMIN_EMAIL: "uat-admin@example.raring2go.test",
      UAT_ADMIN_NAME: "Test UAT Admin"
    } as NodeJS.ProcessEnv);

    const { db, sql } = createDb();
    try {
      const [grant] = await db
        .select({ permissionId: rolePermissions.permissionId })
        .from(rolePermissions)
        .where(and(eq(rolePermissions.roleId, result.roleId), eq(rolePermissions.scope, "system")));

      expect(grant?.permissionId).toBe(fixtureIds.permissions.systemAdminister);
    } finally {
      await sql.end();
    }
  });
});
