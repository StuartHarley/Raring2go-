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
  FranchiseRecord,
  AgreementSigner,
  ESignProvider,
  FranchiseArtifactReference
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

export async function sendAgreementForSignature(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  provider: ESignProvider,
  input: {
    requestId: string;
    agreementId: string;
    signers: Array<Omit<AgreementSigner, "signatureRequestId" | "status">>;
  }
) {
  const agreement = requireAgreement(data, input.agreementId);
  const franchise = requireFranchise(data, agreement.franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "agreementSendSignature");

  if (agreement.status !== "approved") {
    throw new Error("Only approved agreements can be sent for signature.");
  }

  const signers = input.signers
    .map((signer) => ({
      ...signer,
      signatureRequestId: input.requestId,
      status: "pending" as const
    }))
    .sort((left, right) => left.signingOrder - right.signingOrder);

  assertSignerPlan(signers);
  const providerResult = await provider.send({ agreementId: agreement.id, signers });
  const request = {
    id: input.requestId,
    franchiseAgreementId: agreement.id,
    status: "sent" as const,
    providerKey: provider.key,
    providerRequestId: providerResult.providerRequestId,
    providerMetadata: providerResult.metadata ?? {},
    sentAt: today()
  };

  transitionAgreement(agreement, "sent_for_signature");
  data.signatureRequests ??= [];
  data.signers ??= [];
  data.signatureRequests.push(request);
  data.signers.push(...signers.map((signer, index) => ({
    ...signer,
    status: index === 0 ? "sent" as const : "pending" as const
  })));
  await audit.record(agreementAuditEvent(context, "franchise.agreement.sent", franchise, agreement));
  addDomainEvent(data, "franchise.agreement.sent", franchise, agreement);
  return request;
}

export async function resendSignatureRequest(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  provider: ESignProvider,
  requestId: string
) {
  const request = requireSignatureRequest(data, requestId);
  const agreement = requireAgreement(data, request.franchiseAgreementId);
  const franchise = requireFranchise(data, agreement.franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "agreementResendSignature");

  if (!["sent", "partially_signed"].includes(request.status)) {
    throw new Error("Only active signature requests can be resent.");
  }

  const result = await provider.resend({ providerRequestId: request.providerRequestId ?? "" });
  request.providerMetadata = { ...(request.providerMetadata ?? {}), resend: result.metadata ?? {} };
  await audit.record(agreementAuditEvent(context, "franchise.agreement.resent", franchise, agreement));
  return request;
}

export async function cancelSignatureRequest(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  provider: ESignProvider,
  requestId: string
) {
  const request = requireSignatureRequest(data, requestId);
  const agreement = requireAgreement(data, request.franchiseAgreementId);
  const franchise = requireFranchise(data, agreement.franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "agreementCancelSignature");

  if (["completed", "cancelled", "expired", "declined", "reissued"].includes(request.status)) {
    throw new Error("Signature request is already terminal.");
  }

  const result = await provider.cancel({ providerRequestId: request.providerRequestId });
  request.status = "cancelled";
  request.cancelledAt = today();
  request.providerMetadata = { ...(request.providerMetadata ?? {}), cancel: result.metadata ?? {} };
  await audit.record(agreementAuditEvent(context, "franchise.agreement.cancelled", franchise, agreement));
  addDomainEvent(data, "franchise.agreement.cancelled", franchise, agreement);
  return request;
}

export async function reissueSignatureRequest(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  provider: ESignProvider,
  input: {
    oldRequestId: string;
    newRequestId: string;
    signers: Array<Omit<AgreementSigner, "signatureRequestId" | "status">>;
  }
) {
  const oldRequest = requireSignatureRequest(data, input.oldRequestId);
  const agreement = requireAgreement(data, oldRequest.franchiseAgreementId);

  if (agreement.status === "executed") {
    throw new Error("Executed agreements cannot be reissued.");
  }

  oldRequest.status = "reissued";
  agreement.status = "approved";
  return sendAgreementForSignature(context, permissions, audit, data, provider, {
    requestId: input.newRequestId,
    agreementId: oldRequest.franchiseAgreementId,
    signers: input.signers
  });
}

export async function recordSignatureProviderEvent(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  input: {
    eventId: string;
    requestId: string;
    eventType: "signer.completed" | "declined" | "expired" | "cancelled" | "completed";
    signerId?: string;
    signedAgreementArtifact?: FranchiseArtifactReference;
    completionCertificateArtifact?: FranchiseArtifactReference;
    payload?: Record<string, unknown>;
  }
) {
  const request = requireSignatureRequest(data, input.requestId);
  const agreement = requireAgreement(data, request.franchiseAgreementId);
  const franchise = requireFranchise(data, agreement.franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "agreementRecordSignatureEvent");

  data.signatureEvents ??= [];
  const existing = data.signatureEvents.find(
    (event) => event.signatureRequestId === input.requestId && event.providerEventId === input.eventId
  );

  if (existing) {
    return { request, agreement, duplicate: true };
  }

  data.signatureEvents.push({
    id: input.eventId,
    signatureRequestId: input.requestId,
    providerEventId: input.eventId,
    eventType: input.eventType,
    payload: input.payload ?? {},
    processedAt: today()
  });

  if (input.eventType === "signer.completed") {
    completeSigner(data, request, input.signerId);
    await audit.record(agreementAuditEvent(context, "franchise.agreement.signer.completed", franchise, agreement));
  }

  if (input.eventType === "declined") {
    request.status = "declined";
    request.declinedAt = today();
    await audit.record(agreementAuditEvent(context, "franchise.agreement.declined", franchise, agreement));
    addDomainEvent(data, "franchise.agreement.declined", franchise, agreement);
  }

  if (input.eventType === "expired") {
    request.status = "expired";
    request.expiredAt = today();
    await audit.record(agreementAuditEvent(context, "franchise.agreement.expired", franchise, agreement));
    addDomainEvent(data, "franchise.agreement.expired", franchise, agreement);
  }

  if (input.eventType === "cancelled") {
    request.status = "cancelled";
    request.cancelledAt = today();
    await audit.record(agreementAuditEvent(context, "franchise.agreement.cancelled", franchise, agreement));
    addDomainEvent(data, "franchise.agreement.cancelled", franchise, agreement);
  }

  if (input.eventType === "completed") {
    executeAgreement(data, request, agreement, franchise, input);
    await audit.record(agreementAuditEvent(context, "franchise.agreement.executed", franchise, agreement));
  }

  return { request, agreement, duplicate: false };
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

  const signatureRequest = (data.signatureRequests ?? []).find(
    (candidate) =>
      candidate.franchiseAgreementId === agreement.id &&
      !candidate.deletedAt &&
      candidate.status !== "reissued"
  );
  const signers = signatureRequest
    ? (data.signers ?? []).filter(
        (signer) => signer.signatureRequestId === signatureRequest.id && !signer.deletedAt
      )
    : [];
  const signedAgreementArtifact = agreement.signedAgreementArtifactId
    ? (data.artifactReferences ?? []).find(
        (artifact) => artifact.id === agreement.signedAgreementArtifactId
      )
    : undefined;
  const completionCertificateArtifact = agreement.completionCertificateArtifactId
    ? (data.artifactReferences ?? []).find(
        (artifact) => artifact.id === agreement.completionCertificateArtifactId
      )
    : undefined;

  return {
    ...agreement,
    template,
    version,
    signatureRequest,
    signers,
    signedAgreementArtifact,
    completionCertificateArtifact
  };
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
    approved: ["sent_for_signature", "superseded"],
    sent_for_signature: ["executed", "void", "superseded"],
    executed: ["superseded"],
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

function requireSignatureRequest(data: FranchiseData, requestId: string) {
  const request = (data.signatureRequests ?? []).find(
    (candidate) => candidate.id === requestId && !candidate.deletedAt
  );

  if (!request) {
    throw new Error("Signature request was not found.");
  }

  return request;
}

function assertSignerPlan(signers: AgreementSigner[]) {
  if (signers.length === 0 || !signers.some((signer) => signer.required)) {
    throw new Error("At least one required signer is needed.");
  }

  const orders = signers.map((signer) => signer.signingOrder).sort((a, b) => a - b);
  const hasInvalidOrder = orders.some((order, index) => order !== index + 1);

  if (hasInvalidOrder) {
    throw new Error("Signer order must be contiguous and start at 1.");
  }
}

function completeSigner(
  data: FranchiseData,
  request: NonNullable<FranchiseData["signatureRequests"]>[number],
  signerId?: string
) {
  const signers = (data.signers ?? []).filter(
    (signer) => signer.signatureRequestId === request.id && !signer.deletedAt
  );
  const signer = signerId
    ? signers.find((candidate) => candidate.id === signerId)
    : signers.find((candidate) => candidate.status !== "completed");

  if (!signer) {
    throw new Error("Signer was not found.");
  }

  const earlierIncomplete = signers.some(
    (candidate) =>
      candidate.required &&
      candidate.signingOrder < signer.signingOrder &&
      candidate.status !== "completed"
  );

  if (earlierIncomplete) {
    throw new Error("Signer order must be completed before later signers.");
  }

  signer.status = "completed";
  signer.completedAt = today();
  request.status = requiredSignersComplete(data, request.id) ? "completed" : "partially_signed";
  request.completedAt = request.status === "completed" ? today() : request.completedAt;

  const nextSigner = signers.find(
    (candidate) =>
      candidate.required &&
      candidate.signingOrder > signer.signingOrder &&
      candidate.status === "pending"
  );

  if (nextSigner) {
    nextSigner.status = "sent";
  }
}

function requiredSignersComplete(data: FranchiseData, requestId: string) {
  const signers = (data.signers ?? []).filter(
    (signer) => signer.signatureRequestId === requestId && !signer.deletedAt
  );

  return signers.length > 0 && signers.every(
    (signer) => !signer.required || signer.status === "completed"
  );
}

function executeAgreement(
  data: FranchiseData,
  request: NonNullable<FranchiseData["signatureRequests"]>[number],
  agreement: FranchiseAgreement,
  franchise: FranchiseRecord,
  input: {
    signedAgreementArtifact?: FranchiseArtifactReference;
    completionCertificateArtifact?: FranchiseArtifactReference;
  }
) {
  if (agreement.status === "executed") {
    return;
  }

  if (!requiredSignersComplete(data, request.id)) {
    throw new Error("Every required signer must complete before execution.");
  }

  if (!input.signedAgreementArtifact || !input.completionCertificateArtifact) {
    throw new Error("Signed agreement and completion certificate references are required.");
  }

  data.artifactReferences ??= [];
  const signedAgreementArtifact = lockArtifact(input.signedAgreementArtifact, franchise, agreement);
  const completionCertificateArtifact = lockArtifact(
    input.completionCertificateArtifact,
    franchise,
    agreement
  );
  data.artifactReferences.push(signedAgreementArtifact, completionCertificateArtifact);
  agreement.signedAgreementArtifactId = signedAgreementArtifact.id;
  agreement.completionCertificateArtifactId = completionCertificateArtifact.id;
  agreement.executedAt = today();
  transitionAgreement(agreement, "executed");
  addDomainEvent(data, "franchise.agreement.executed", franchise, agreement);
}

function lockArtifact(
  artifact: FranchiseArtifactReference,
  franchise: FranchiseRecord,
  agreement: FranchiseAgreement
) {
  return {
    ...artifact,
    franchiseId: franchise.id,
    entityType: "franchise_agreement",
    entityId: agreement.id,
    lockedAt: today()
  };
}

function addDomainEvent(
  data: FranchiseData,
  eventType: string,
  franchise: FranchiseRecord,
  agreement: FranchiseAgreement
) {
  data.domainEvents ??= [];
  const idempotencyKey = `${eventType}:${agreement.id}`;

  if (data.domainEvents.some((event) => event.idempotencyKey === idempotencyKey)) {
    return;
  }

  data.domainEvents.push({
    id: idempotencyKey,
    eventType,
    entityType: "franchise_agreement",
    entityId: agreement.id,
    organisationId: franchise.franchiseOrganisationId,
    territoryId: franchise.primaryTerritoryId,
    idempotencyKey,
    payload: {
      franchiseId: franchise.id,
      agreementId: agreement.id
    }
  });
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
    | "franchise.agreement.void"
    | "franchise.agreement.sent"
    | "franchise.agreement.signer.completed"
    | "franchise.agreement.declined"
    | "franchise.agreement.expired"
    | "franchise.agreement.cancelled"
    | "franchise.agreement.executed"
    | "franchise.agreement.resent",
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
  agreementVoid: auditActions.franchiseAgreementVoid,
  agreementSent: auditActions.franchiseAgreementSent,
  agreementSignerCompleted: auditActions.franchiseAgreementSignerCompleted,
  agreementDeclined: auditActions.franchiseAgreementDeclined,
  agreementExpired: auditActions.franchiseAgreementExpired,
  agreementCancelled: auditActions.franchiseAgreementCancelled,
  agreementExecuted: auditActions.franchiseAgreementExecuted
} as const;
