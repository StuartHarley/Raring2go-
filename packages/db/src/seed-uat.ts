import { eq, sql } from "drizzle-orm";
import { createDb } from "./client";
import {
  memberships,
  organisations,
  permissions,
  rolePermissions,
  roles,
  territories,
  userRoleAssignments,
  users
} from "./schema";

const uatIds = {
  organisation: "10000000-0000-4000-8000-000000000001",
  territory: "10000000-0000-4000-8000-000000000101",
  user: "10000000-0000-4000-8000-000000000201",
  role: "10000000-0000-4000-8000-000000000301",
  permissions: {
    systemAdminister: "10000000-0000-4000-8000-000000000401",
    rolesView: "10000000-0000-4000-8000-000000000402",
    integrationsView: "10000000-0000-4000-8000-000000000403"
  },
  membership: "10000000-0000-4000-8000-000000000501",
  assignment: "10000000-0000-4000-8000-000000000601"
};

export async function seedUatDatabase(databaseUrl?: string, source = process.env) {
  const adminEmail = normaliseEmail(source.UAT_ADMIN_EMAIL);
  const adminName = source.UAT_ADMIN_NAME?.trim() || "Raring2go UAT Admin";
  const { db, sql: client } = createDb(databaseUrl);

  try {
    await db.insert(organisations).values({
      id: uatIds.organisation,
      kind: "hq",
      name: "Raring2go HQ UAT"
    }).onConflictDoUpdate({
      target: organisations.id,
      set: {
        kind: sql`excluded.kind`,
        name: sql`excluded.name`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(territories).values({
      id: uatIds.territory,
      franchiseOrganisationId: null,
      code: "uat-network",
      name: "UAT Network Context",
      status: "active"
    }).onConflictDoUpdate({
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

    await db.insert(users).values({
      id: uatIds.user,
      email: adminEmail,
      displayName: adminName,
      status: "active"
    }).onConflictDoUpdate({
      target: users.id,
      set: {
        email: sql`excluded.email`,
        displayName: sql`excluded.display_name`,
        status: sql`excluded.status`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(roles).values({
      id: uatIds.role,
      key: "uat-super-admin",
      name: "UAT Super Admin",
      description: "Minimal UAT role for internal app access and provider setup verification.",
      isSystem: true
    }).onConflictDoUpdate({
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

    await db.insert(permissions).values([
      {
        id: uatIds.permissions.systemAdminister,
        module: "system",
        action: "administer",
        description: "Administer system settings for UAT."
      },
      {
        id: uatIds.permissions.rolesView,
        module: "roles",
        action: "view",
        description: "View role and permission assignments for UAT."
      },
      {
        id: uatIds.permissions.integrationsView,
        module: "integrations",
        action: "view",
        description: "View provider connections during UAT."
      }
    ]).onConflictDoUpdate({
      target: permissions.id,
      set: {
        module: sql`excluded.module`,
        action: sql`excluded.action`,
        description: sql`excluded.description`,
        updatedAt: sql`now()`
      }
    });

    await db.insert(memberships).values({
      id: uatIds.membership,
      userId: uatIds.user,
      organisationId: uatIds.organisation,
      status: "active"
    }).onConflictDoNothing();

    await db.insert(rolePermissions).values([
      {
        roleId: uatIds.role,
        permissionId: uatIds.permissions.systemAdminister,
        scope: "system",
        constraints: {}
      },
      {
        roleId: uatIds.role,
        permissionId: uatIds.permissions.rolesView,
        scope: "network",
        constraints: {}
      },
      {
        roleId: uatIds.role,
        permissionId: uatIds.permissions.integrationsView,
        scope: "network",
        constraints: {}
      }
    ]).onConflictDoNothing();

    const existingAssignments = await db
      .select({ id: userRoleAssignments.id })
      .from(userRoleAssignments)
      .where(eq(userRoleAssignments.id, uatIds.assignment));

    if (!existingAssignments.length) {
      await db.insert(userRoleAssignments).values({
        id: uatIds.assignment,
        userId: uatIds.user,
        roleId: uatIds.role,
        organisationId: uatIds.organisation,
        territoryId: null
      });
    }

    return {
      organisationId: uatIds.organisation,
      territoryId: uatIds.territory,
      userId: uatIds.user,
      roleId: uatIds.role,
      adminEmail
    };
  } finally {
    await client.end();
  }
}

function normaliseEmail(value?: string) {
  const email = value?.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    throw new Error("UAT_ADMIN_EMAIL must be set to a valid email address.");
  }

  return email;
}

async function main() {
  await seedUatDatabase();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
