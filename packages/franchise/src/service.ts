import { auditActions } from "@raring2go/audit";
import {
  evaluatePermission,
  PermissionDeniedError,
  requirePermission
} from "@raring2go/permissions";
import type { RecordAuditEventInput } from "@raring2go/audit";
import type { PermissionData } from "@raring2go/permissions";
import { franchiseCapabilities } from "./permissions";
import type {
  Franchise360,
  FranchiseContact,
  FranchiseData,
  FranchiseRecord
} from "./types";

type FranchiseAuditRecorder = {
  record(input: RecordAuditEventInput): Promise<void>;
};

export type FranchiseActorContext = {
  userId: string;
  organisationId: string;
  territoryId?: string;
};

export function listActiveFranchises(
  context: FranchiseActorContext,
  permissions: PermissionData,
  data: FranchiseData
) {
  return data.franchises.filter((franchise) => {
    if (franchise.deletedAt || franchise.status === "archived") {
      return false;
    }

    return canAccessFranchise(context, permissions, franchise, "view");
  });
}

export function getFranchise360(
  context: FranchiseActorContext,
  permissions: PermissionData,
  data: FranchiseData,
  franchiseId: string
): Franchise360 {
  const franchise = data.franchises.find((candidate) => candidate.id === franchiseId);

  if (!franchise || franchise.deletedAt || franchise.status === "archived") {
    throw new Error("Franchise was not found.");
  }

  requireFranchiseAccess(context, permissions, franchise, "view");

  const organisation = data.organisations.find(
    (candidate) => candidate.id === franchise.franchiseOrganisationId
  );
  const territory = data.territories.find(
    (candidate) => candidate.id === franchise.primaryTerritoryId
  );

  if (!organisation || !territory) {
    throw new Error("Franchise relationship is incomplete.");
  }

  const owner = franchise.primaryOwnerUserId
    ? data.users.find((candidate) => candidate.id === franchise.primaryOwnerUserId)
    : undefined;

  const contacts = data.contacts
    .filter((contact) => contact.franchiseId === franchise.id && !contact.deletedAt)
    .map((contact) => ({
      ...contact,
      user: contact.userId
        ? data.users.find((candidate) => candidate.id === contact.userId)
        : undefined
    }));

  return {
    franchise,
    organisation,
    territory,
    owner,
    contacts,
    activity: (data.activity ?? []).filter(
      (event) => event.entityType === "franchise" && event.entityId === franchise.id
    ),
    placeholders: {
      performance: "deferred",
      agreement: "deferred",
      compliance: "deferred",
      training: "deferred",
      support: "deferred",
      documents: "deferred"
    }
  };
}

export async function createFranchise(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  input: FranchiseRecord
) {
  requirePermission(
    permissionRequest(context, input.primaryTerritoryId, "create"),
    permissions
  );

  if (data.franchises.some((franchise) => franchise.id === input.id)) {
    throw new Error("Franchise already exists.");
  }

  data.franchises.push(input);
  await audit.record(franchiseAuditEvent(context, "franchise.create", input));
  return input;
}

export async function updateFranchise(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  input: {
    franchiseId: string;
    patch: Partial<
      Pick<
        FranchiseRecord,
        | "status"
        | "lifecycleStage"
        | "launchDate"
        | "renewalDate"
        | "endDate"
        | "onboardingStatus"
        | "supportStatus"
        | "tags"
      >
    >;
  }
) {
  const franchise = data.franchises.find(
    (candidate) => candidate.id === input.franchiseId
  );

  if (!franchise || franchise.deletedAt) {
    throw new Error("Franchise was not found.");
  }

  requireFranchiseAccess(context, permissions, franchise, "edit");
  const before = { ...franchise };
  Object.assign(franchise, input.patch);

  await audit.record(
    franchiseAuditEvent(context, "franchise.update", franchise, before, franchise)
  );

  return franchise;
}

export function assertNoDuplicatedIdentityData(franchise: FranchiseRecord) {
  const forbiddenKeys = ["legalName", "companyNumber", "vatNumber", "territoryName"];
  const record = franchise as unknown as Record<string, unknown>;
  return forbiddenKeys.every((key) => record[key] === undefined);
}

function canAccessFranchise(
  context: FranchiseActorContext,
  permissions: PermissionData,
  franchise: FranchiseRecord,
  action: "view" | "create" | "edit"
) {
  if (context.territoryId && context.territoryId !== franchise.primaryTerritoryId) {
    return false;
  }

  return evaluatePermission(
    permissionRequest(context, franchise.primaryTerritoryId, action),
    permissions
  ).allowed;
}

function requireFranchiseAccess(
  context: FranchiseActorContext,
  permissions: PermissionData,
  franchise: FranchiseRecord,
  action: "view" | "create" | "edit"
) {
  assertRecordTerritory(context, franchise);

  try {
    return requirePermission(
      permissionRequest(context, franchise.primaryTerritoryId, action),
      permissions
    );
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      throw error;
    }

    throw error;
  }
}

function permissionRequest(
  context: FranchiseActorContext,
  territoryId: string,
  action: "view" | "create" | "edit"
) {
  return {
    userId: context.userId,
    module: franchiseCapabilities[action].module,
    action: franchiseCapabilities[action].action,
    context: {
      organisationId: context.organisationId,
      territoryId: context.territoryId
    }
  };
}

function assertRecordTerritory(
  context: FranchiseActorContext,
  franchise: FranchiseRecord
) {
  if (context.territoryId && context.territoryId !== franchise.primaryTerritoryId) {
    throw new PermissionDeniedError({
      allowed: false,
      reason: "scope_mismatch",
      explanation: "Franchise is outside the active territory context."
    });
  }
}

function franchiseAuditEvent(
  context: FranchiseActorContext,
  action: "franchise.create" | "franchise.update",
  franchise: FranchiseRecord,
  before?: Record<string, unknown>,
  after?: Record<string, unknown>
): RecordAuditEventInput {
  return {
    action,
    actor: {
      type: "human",
      userId: context.userId
    },
    entity: {
      type: "franchise",
      id: franchise.id
    },
    scope: {
      organisationId: franchise.franchiseOrganisationId,
      territoryId: franchise.primaryTerritoryId
    },
    before,
    after,
    metadata: {
      source: "franchise_360"
    }
  };
}

export function createContactLabel(contact: FranchiseContact) {
  return contact.userId ? contact.label : `${contact.label} (external)`;
}

export const franchiseAuditActions = {
  create: auditActions.franchiseCreate,
  update: auditActions.franchiseUpdate
} as const;
