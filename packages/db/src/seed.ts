import { sql } from "drizzle-orm";
import { createDb } from "./client";
import { fixtureIds, foundationSeed } from "./fixtures";
import {
  auditEvents,
  agreementTemplates,
  agreementVersions,
  authInvitations,
  franchiseArtifactReferences,
  franchiseContacts,
  franchiseDocuments,
  franchiseDocumentVersions,
  franchises,
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
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.franchiseView,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.franchiseCreate,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.franchiseEdit,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.franchiseView,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.agreementView,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.agreementGenerate,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.agreementSubmitApproval,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.agreementApprove,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.agreementVoid,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.agreementView,
        scope: "own_territory",
        constraints: {}
      },
      ...[
        fixtureIds.permissions.agreementSendSignature,
        fixtureIds.permissions.agreementCancelSignature,
        fixtureIds.permissions.agreementResendSignature,
        fixtureIds.permissions.agreementViewSignatureStatus,
        fixtureIds.permissions.agreementRecordSignatureEvent,
        fixtureIds.permissions.agreementDownloadExecuted
      ].map((permissionId) => ({
        roleId: fixtureIds.roles.hqAdmin,
        permissionId,
        scope: "network" as const,
        constraints: {}
      })),
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.agreementViewSignatureStatus,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.agreementDownloadExecuted,
        scope: "own_territory",
        constraints: {}
      },
      ...[
        fixtureIds.permissions.documentView,
        fixtureIds.permissions.documentUpload,
        fixtureIds.permissions.documentDownload,
        fixtureIds.permissions.documentArchive
      ].map((permissionId) => ({
        roleId: fixtureIds.roles.hqAdmin,
        permissionId,
        scope: "network" as const,
        constraints: {}
      })),
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.documentView,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.documentDownload,
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
        id: "00000000-0000-4000-8000-000000000603",
        userId: fixtureIds.users.superAdmin,
        roleId: fixtureIds.roles.hqAdmin,
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

    const franchiseSeed = foundationSeed.franchises.map((franchise) => {
      const endDate = (franchise as { endDate?: string }).endDate;

      return {
        ...franchise,
        launchDate: franchise.launchDate ? new Date(franchise.launchDate) : null,
        renewalDate: franchise.renewalDate ? new Date(franchise.renewalDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        tags: [...franchise.tags]
      };
    });

    await db.insert(franchises).values(franchiseSeed).onConflictDoUpdate({
      target: franchises.id,
      set: {
        franchiseOrganisationId: sql`excluded.franchise_organisation_id`,
        primaryTerritoryId: sql`excluded.primary_territory_id`,
        primaryOwnerUserId: sql`excluded.primary_owner_user_id`,
        status: sql`excluded.status`,
        lifecycleStage: sql`excluded.lifecycle_stage`,
        launchDate: sql`excluded.launch_date`,
        renewalDate: sql`excluded.renewal_date`,
        endDate: sql`excluded.end_date`,
        onboardingStatus: sql`excluded.onboarding_status`,
        supportStatus: sql`excluded.support_status`,
        tags: sql`excluded.tags`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(franchiseContacts).values([...foundationSeed.franchiseContacts]).onConflictDoUpdate({
      target: franchiseContacts.id,
      set: {
        franchiseId: sql`excluded.franchise_id`,
        userId: sql`excluded.user_id`,
        label: sql`excluded.label`,
        name: sql`excluded.name`,
        email: sql`excluded.email`,
        phone: sql`excluded.phone`,
        isPrimary: sql`excluded.is_primary`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(agreementTemplates).values([...foundationSeed.agreementTemplates]).onConflictDoUpdate({
      target: agreementTemplates.id,
      set: {
        key: sql`excluded.key`,
        name: sql`excluded.name`,
        status: sql`excluded.status`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(agreementVersions).values(foundationSeed.agreementVersions.map((version) => ({
      ...version,
      controlledMergeFields: [...version.controlledMergeFields],
      approvedAt: version.approvedAt ? new Date(version.approvedAt) : null
    }))).onConflictDoUpdate({
      target: agreementVersions.id,
      set: {
        templateId: sql`excluded.template_id`,
        version: sql`excluded.version`,
        status: sql`excluded.status`,
        controlledMergeFields: sql`excluded.controlled_merge_fields`,
        content: sql`excluded.content`,
        approvedByUserId: sql`excluded.approved_by_user_id`,
        approvedAt: sql`excluded.approved_at`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(franchiseArtifactReferences).values([...foundationSeed.franchiseArtifactReferences]).onConflictDoUpdate({
      target: franchiseArtifactReferences.id,
      set: {
        franchiseId: sql`excluded.franchise_id`,
        entityType: sql`excluded.entity_type`,
        entityId: sql`excluded.entity_id`,
        category: sql`excluded.category`,
        label: sql`excluded.label`,
        storageKey: sql`excluded.storage_key`,
        contentType: sql`excluded.content_type`,
        checksum: sql`excluded.checksum`,
        providerMetadata: sql`excluded.provider_metadata`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(franchiseDocuments).values(foundationSeed.franchiseDocuments.map((document) => ({
      ...document,
      expiryDate: null,
      archivedAt: null
    }))).onConflictDoUpdate({
      target: franchiseDocuments.id,
      set: {
        franchiseId: sql`excluded.franchise_id`,
        organisationId: sql`excluded.organisation_id`,
        territoryId: sql`excluded.territory_id`,
        category: sql`excluded.category`,
        documentType: sql`excluded.document_type`,
        title: sql`excluded.title`,
        description: sql`excluded.description`,
        status: sql`excluded.status`,
        currentVersionId: sql`excluded.current_version_id`,
        uploadedByUserId: sql`excluded.uploaded_by_user_id`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(franchiseDocumentVersions).values(foundationSeed.franchiseDocumentVersions.map((version) => ({
      ...version,
      uploadedAt: version.uploadedAt ? new Date(version.uploadedAt) : null
    }))).onConflictDoUpdate({
      target: franchiseDocumentVersions.id,
      set: {
        documentId: sql`excluded.document_id`,
        versionNumber: sql`excluded.version_number`,
        artifactReferenceId: sql`excluded.artifact_reference_id`,
        uploadedByUserId: sql`excluded.uploaded_by_user_id`,
        uploadedAt: sql`excluded.uploaded_at`,
        notes: sql`excluded.notes`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

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
