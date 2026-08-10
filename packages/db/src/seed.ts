import { sql } from "drizzle-orm";
import { createDb } from "./client";
import { fixtureIds, foundationSeed } from "./fixtures";
import {
  auditEvents,
  authInvitations,
  memberships,
  organisations,
  permissions,
  rolePermissions,
  roles,
  territories,
  userRoleAssignments,
  users
} from "./schema";

export async function seedDatabase(databaseUrl?: string) {
  const { db, sql: client } = createDb(databaseUrl);

  try {
    await db.insert(organisations).values([...foundationSeed.organisations]).onConflictDoUpdate({
      target: organisations.id,
      set: {
        kind: sql`excluded.kind`,
        name: sql`excluded.name`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(territories).values([...foundationSeed.territories]).onConflictDoUpdate({
      target: territories.id,
      set: {
        franchiseOrganisationId: sql`excluded.franchise_organisation_id`,
        code: sql`excluded.code`,
        name: sql`excluded.name`,
        status: sql`excluded.status`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(users).values([...foundationSeed.users]).onConflictDoUpdate({
      target: users.id,
      set: {
        email: sql`excluded.email`,
        displayName: sql`excluded.display_name`,
        status: sql`excluded.status`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(roles).values([...foundationSeed.roles]).onConflictDoUpdate({
      target: roles.id,
      set: {
        key: sql`excluded.key`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        isSystem: sql`excluded.is_system`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(permissions).values([...foundationSeed.permissions]).onConflictDoUpdate({
      target: permissions.id,
      set: {
        module: sql`excluded.module`,
        action: sql`excluded.action`,
        description: sql`excluded.description`,
        updatedAt: sql`now()`
      }
    });

    await db.insert(memberships).values([
      {
        id: "00000000-0000-4000-8000-000000000501",
        userId: fixtureIds.users.superAdmin,
        organisationId: fixtureIds.organisations.hq
      },
      {
        id: "00000000-0000-4000-8000-000000000502",
        userId: fixtureIds.users.franchisee,
        organisationId: fixtureIds.organisations.franchise
      }
    ]).onConflictDoNothing();

    await db.insert(rolePermissions).values([
      {
        roleId: fixtureIds.roles.superAdmin,
        permissionId: fixtureIds.permissions.systemAdminister,
        scope: "system",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.rolesView,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.territoryView,
        scope: "own_territory",
        constraints: {}
      }
    ]).onConflictDoNothing();

    await db.insert(userRoleAssignments).values([
      {
        id: "00000000-0000-4000-8000-000000000601",
        userId: fixtureIds.users.superAdmin,
        roleId: fixtureIds.roles.superAdmin,
        organisationId: fixtureIds.organisations.hq
      },
      {
        id: "00000000-0000-4000-8000-000000000602",
        userId: fixtureIds.users.franchisee,
        roleId: fixtureIds.roles.franchisee,
        organisationId: fixtureIds.organisations.franchise,
        territoryId: fixtureIds.territories.suttonColdfield
      }
    ]).onConflictDoNothing();

    await db.insert(auditEvents).values({
      id: "00000000-0000-4000-8000-000000000701",
      actorUserId: fixtureIds.users.superAdmin,
      action: "seed.foundation",
      entityType: "organisation",
      entityId: fixtureIds.organisations.franchise,
      organisationId: fixtureIds.organisations.hq,
      payload: {
        deterministic: true,
        ticket: "FND-003"
      }
    }).onConflictDoNothing();

    await db.insert(authInvitations).values({
      id: fixtureIds.invitations.franchiseStaff,
      email: "staff@example.raring2go.test",
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield,
      tokenHash:
        "0000000000000000000000000000000000000000000000000000000000000801",
      status: "pending",
      invitedByUserId: fixtureIds.users.superAdmin,
      expiresAt: new Date("2099-01-01T00:00:00.000Z")
    }).onConflictDoNothing();

    return fixtureIds;
  } finally {
    await client.end();
  }
}

async function main() {
  await seedDatabase();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
