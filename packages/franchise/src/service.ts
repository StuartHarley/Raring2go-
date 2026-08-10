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
  FranchiseAgreement,
  FranchiseAgreementStatus,
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

  const agreement = currentAgreement(data, franchise.id);

  return {
    franchise,
    organisation,
    territory,
    owner,
    contacts,
    agreement,
    activity: (data.activity ?? []).filter(
      (event) => event.entityType === "franchise" && event.entityId === franchise.id
    ),
    placeholders: {
      performance: "deferred",
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

export async function generateAgreement(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  input: {
    id: string;
    franchiseId: string;
    agreementVersionId: string;
    mergeVariables: Record<string, string | number | boolean | null>;
  }
) {
  const franchise = requireFranchise(data, input.franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "agreementGenerate");
  const version = requireApprovedAgreementVersion(data, input.agreementVersionId);
  assertControlledMergeVariables(version.controlledMergeFields, input.mergeVariables);

  if (currentAgreement(data, franchise.id)?.status === "approved") {
    throw new Error("Approved agreements are durable. Create a revised draft instead.");
  }

  const agreement: FranchiseAgreement = {
    id: input.id,
    franchiseId: franchise.id,
    agreementVersionId: version.id,
    status: "draft",
    mergeVariables: { ...input.mergeVariables },
    generatedContent: renderAgreementContent(version.content, input.mergeVariables)
  };

  data.franchiseAgreements ??= [];
  data.franchiseAgreements.push(agreement);
  await audit.record(agreementAuditEvent(context, "franchise.agreement.generate", franchise, agreement));
  return agreement;
}

export async function submitAgreementForApproval(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  agreementId: string
) {
  const agreement = requireAgreement(data, agreementId);
  const franchise = requireFranchise(data, agreement.franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "agreementSubmitApproval");
  transitionAgreement(agreement, "pending_internal_approval");
  agreement.submittedAt = today();
  await audit.record(agreementAuditEvent(context, "franchise.agreement.submit", franchise, agreement));
  return agreement;
}

export async function approveAgreement(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  agreementId: string
) {
  const agreement = requireAgreement(data, agreementId);
  const franchise = requireFranchise(data, agreement.franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "agreementApprove");
  transitionAgreement(agreement, "approved");
  agreement.approvedByUserId = context.userId;
  agreement.approvedAt = today();
  await audit.record(agreementAuditEvent(context, "franchise.agreement.approve", franchise, agreement));
  return agreement;
}

export async function voidAgreement(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  agreementId: string
) {
  const agreement = requireAgreement(data, agreementId);
  const franchise = requireFranchise(data, agreement.franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "agreementVoid");
  transitionAgreement(agreement, "void");
  agreement.voidedAt = today();
  await audit.record(agreementAuditEvent(context, "franchise.agreement.void", franchise, agreement));
  return agreement;
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
  action: FranchiseCapability
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
  action: FranchiseCapability
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
  action: FranchiseCapability
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

type FranchiseCapability = keyof typeof franchiseCapabilities;

function requireFranchise(data: FranchiseData, franchiseId: string) {
  const franchise = data.franchises.find((candidate) => candidate.id === franchiseId);

  if (!franchise || franchise.deletedAt || franchise.status === "archived") {
    throw new Error("Franchise was not found.");
  }

  return franchise;
}

function requireAgreement(data: FranchiseData, agreementId: string) {
  const agreement = (data.franchiseAgreements ?? []).find(
    (candidate) => candidate.id === agreementId && !candidate.deletedAt
  );

  if (!agreement) {
    throw new Error("Agreement was not found.");
  }

  return agreement;
}

function requireApprovedAgreementVersion(data: FranchiseData, versionId: string) {
  const version = (data.agreementVersions ?? []).find(
    (candidate) => candidate.id === versionId && !candidate.deletedAt
  );

  if (!version || version.status !== "approved") {
    throw new Error("Agreement version must be approved before generation.");
  }

  return version;
}

function currentAgreement(data: FranchiseData, franchiseId: string) {
  const agreement = (data.franchiseAgreements ?? []).find(
    (candidate) =>
      candidate.franchiseId === franchiseId &&
      !candidate.deletedAt &&
      candidate.status !== "void" &&
      candidate.status !== "superseded"
  );

  if (!agreement) {
    return undefined;
  }

  const version = (data.agreementVersions ?? []).find(
    (candidate) => candidate.id === agreement.agreementVersionId
  );
  const template = version
    ? (data.agreementTemplates ?? []).find((candidate) => candidate.id === version.templateId)
    : undefined;

  if (!version || !template) {
    return undefined;
  }

  return { ...agreement, template, version };
}

function assertControlledMergeVariables(
  fields: string[],
  values: Record<string, string | number | boolean | null>
) {
  const provided = Object.keys(values);
  const missing = fields.filter((field) => !(field in values));
  const unexpected = provided.filter((field) => !fields.includes(field));

  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error("Agreement merge variables do not match the approved template fields.");
  }
}

function renderAgreementContent(
  content: Record<string, unknown>,
  variables: Record<string, string | number | boolean | null>
) {
  return {
    ...content,
    mergeVariables: { ...variables }
  };
}

function transitionAgreement(
  agreement: FranchiseAgreement,
  next: FranchiseAgreementStatus
) {
  const allowed: Record<FranchiseAgreementStatus, FranchiseAgreementStatus[]> = {
    draft: ["pending_internal_approval", "void"],
    pending_internal_approval: ["approved", "void"],
    approved: ["superseded"],
    void: [],
    superseded: []
  };

  if (!allowed[agreement.status].includes(next)) {
    throw new Error(`Invalid agreement lifecycle transition: ${agreement.status} -> ${next}.`);
  }

  agreement.status = next;
}

function today() {
  return new Date().toISOString().slice(0, 10);
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

function agreementAuditEvent(
  context: FranchiseActorContext,
  action:
    | "franchise.agreement.generate"
    | "franchise.agreement.submit"
    | "franchise.agreement.approve"
    | "franchise.agreement.void",
  franchise: FranchiseRecord,
  agreement: FranchiseAgreement
): RecordAuditEventInput {
  return {
    action,
    actor: {
      type: "human",
      userId: context.userId
    },
    entity: {
      type: "franchise_agreement",
      id: agreement.id
    },
    scope: {
      organisationId: franchise.franchiseOrganisationId,
      territoryId: franchise.primaryTerritoryId
    },
    after: {
      status: agreement.status,
      agreementVersionId: agreement.agreementVersionId,
      mergeVariables: agreement.mergeVariables
    },
    metadata: {
      franchiseId: franchise.id,
      source: "franchise_360"
    }
  };
}

export function createContactLabel(contact: FranchiseContact) {
  return contact.userId ? contact.label : `${contact.label} (external)`;
}

export const franchiseAuditActions = {
  create: auditActions.franchiseCreate,
  update: auditActions.franchiseUpdate,
  agreementGenerate: auditActions.franchiseAgreementGenerate,
  agreementSubmit: auditActions.franchiseAgreementSubmit,
  agreementApprove: auditActions.franchiseAgreementApprove,
  agreementVoid: auditActions.franchiseAgreementVoid
} as const;
