import { randomUUID } from "node:crypto";
import { count, eq, ne, sql } from "drizzle-orm";
import { createDb, requireMigrationDatabaseUrl } from "./client";
import { fixtureIds, fixtureRolePermissions, foundationSeed } from "./fixtures";
import {
  advertiserTaxRates,
  auditEvents,
  complianceRequirements,
  memberships,
  onboardingTemplatePhases,
  onboardingTemplateTasks,
  onboardingTemplates,
  organisations,
  permissions,
  pipelineStages,
  rolePermissions,
  roles,
  userRoleAssignments,
  users
} from "./schema";

/**
 * Production bootstrap: the approved way to set up (and afterwards keep in step) a real environment. Unlike the development seed it
 * creates no demo users, territories, franchises, advertisers, audience or content.
 *
 * Every run syncs the reference data the app needs: the head-office organisation, roles, the permission catalogue and role grants, the
 * workflow automation system user, CRM pipeline stages, tax rates, compliance requirements and onboarding templates. It is safe to
 * repeat, and should be run after every migration so a newly added permission reaches production. Grants are only ever added, never
 * removed, so access an administrator has granted by hand is not undone.
 *
 * Given an admin email, the first run also creates that person as head-office Super Admin, so they can sign in by email link and
 * invite everyone else. That is refused if any other real user already exists.
 */

const emailPattern = /^[^\s@,;<>()[\]\\"]{1,64}@[^\s@,;<>()[\]\\"]{1,255}\.[a-z]{2,}$/i;
const automationEmail = "workflow-automation@system.raring2go.test";

export type BootstrapResult = { adminCreated: boolean; adminEmail: string | null; permissions: number; roles: number };

export async function bootstrapProduction(input: { adminEmail?: string; adminName?: string; databaseUrl?: string } = {}): Promise<BootstrapResult> {
  const adminEmail = input.adminEmail?.trim().toLowerCase() || null;
  if (adminEmail && !emailPattern.test(adminEmail)) throw new Error("The admin email is not a valid address.");
  if (adminEmail && adminEmail.endsWith(".test")) throw new Error("The admin email must be a real address.");

  const { db, sql: client } = createDb(input.databaseUrl ?? requireMigrationDatabaseUrl());
  try {
    return await db.transaction(async (tx) => {
      const hq = foundationSeed.organisations.find((organisation) => organisation.id === fixtureIds.organisations.hq)!;
      await tx.insert(organisations).values({ ...hq }).onConflictDoUpdate({ target: organisations.id, set: { name: sql`excluded.name`, updatedAt: sql`now()`, deletedAt: sql`null` } });

      await tx.insert(roles).values([...foundationSeed.roles]).onConflictDoUpdate({
        target: roles.id,
        set: { key: sql`excluded.key`, name: sql`excluded.name`, description: sql`excluded.description`, isSystem: sql`excluded.is_system`, franchiseDelegable: sql`excluded.franchise_delegable`, updatedAt: sql`now()`, deletedAt: sql`null` }
      });
      await tx.insert(permissions).values([...foundationSeed.permissions]).onConflictDoUpdate({
        target: permissions.id,
        set: { module: sql`excluded.module`, action: sql`excluded.action`, description: sql`excluded.description`, updatedAt: sql`now()` }
      });
      await tx.insert(rolePermissions).values(fixtureRolePermissions).onConflictDoNothing();

      // The workflow engine acts as this system user; it cannot sign in (no deliverable address).
      const automation = foundationSeed.users.find((user) => user.id === fixtureIds.users.workflowAutomation)!;
      await tx.insert(users).values({ ...automation }).onConflictDoUpdate({ target: users.id, set: { email: sql`excluded.email`, displayName: sql`excluded.display_name`, updatedAt: sql`now()`, deletedAt: sql`null` } });
      await tx.insert(memberships).values({ id: randomUUID(), userId: fixtureIds.users.workflowAutomation, organisationId: fixtureIds.organisations.hq }).onConflictDoNothing();
      await tx.insert(userRoleAssignments).values({ id: randomUUID(), userId: fixtureIds.users.workflowAutomation, roleId: fixtureIds.roles.automation, organisationId: fixtureIds.organisations.hq }).onConflictDoNothing();

      await tx.insert(pipelineStages).values([...foundationSeed.pipelineStages]).onConflictDoUpdate({
        target: pipelineStages.id,
        set: { key: sql`excluded.key`, name: sql`excluded.name`, sortOrder: sql`excluded.sort_order`, probabilityDefault: sql`excluded.probability_default`, isClosed: sql`excluded.is_closed`, outcome: sql`excluded.outcome`, updatedAt: sql`now()`, deletedAt: sql`null` }
      });
      await tx.insert(advertiserTaxRates).values([...foundationSeed.advertiserTaxRates]).onConflictDoNothing();
      await tx.insert(complianceRequirements).values([...foundationSeed.complianceRequirements]).onConflictDoNothing();
      await tx.insert(onboardingTemplates).values([...foundationSeed.onboardingTemplates]).onConflictDoNothing();
      await tx.insert(onboardingTemplatePhases).values([...foundationSeed.onboardingTemplatePhases]).onConflictDoNothing();
      await tx.insert(onboardingTemplateTasks).values(foundationSeed.onboardingTemplateTasks.map((task) => ({ ...task, dueRule: { ...task.dueRule }, dependencyRules: [...task.dependencyRules] }))).onConflictDoNothing();

      let adminCreated = false;
      if (adminEmail) {
        const others = await tx.select({ email: users.email }).from(users).where(ne(users.id, fixtureIds.users.workflowAutomation));
        if (others.some((user) => user.email !== adminEmail)) {
          throw new Error("This database already has other users, so a first admin will not be created. Invite people from the Roles page instead.");
        }
        if (others.length === 0) {
          const userId = randomUUID();
          await tx.insert(users).values({ id: userId, email: adminEmail, displayName: input.adminName?.trim() || adminEmail, status: "active" });
          await tx.insert(memberships).values({ id: randomUUID(), userId, organisationId: fixtureIds.organisations.hq });
          await tx.insert(userRoleAssignments).values([
            { id: randomUUID(), userId, roleId: fixtureIds.roles.superAdmin, organisationId: fixtureIds.organisations.hq },
            { id: randomUUID(), userId, roleId: fixtureIds.roles.hqAdmin, organisationId: fixtureIds.organisations.hq }
          ]);
          await tx.insert(auditEvents).values({ id: randomUUID(), actorUserId: userId, action: "bootstrap.first_admin", entityType: "user", entityId: userId, organisationId: fixtureIds.organisations.hq, payload: { source: "db:bootstrap" } });
          adminCreated = true;
        }
      }

      const [permissionCount] = await tx.select({ n: count() }).from(permissions);
      const [roleCount] = await tx.select({ n: count() }).from(roles).where(eq(roles.isSystem, true));
      return { adminCreated, adminEmail, permissions: permissionCount!.n, roles: roleCount!.n };
    });
  } finally {
    await client.end();
  }
}

async function main() {
  const result = await bootstrapProduction({ adminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL, adminName: process.env.BOOTSTRAP_ADMIN_NAME });
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
