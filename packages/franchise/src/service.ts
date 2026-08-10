import { randomUUID } from "node:crypto";
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
  FranchiseArtifactReference,
  FranchiseDocument,
  FranchiseDocumentVersion,
  FranchiseInsurancePolicy,
  FranchiseComplianceRecord,
  ComplianceRecordStatus,
  FranchiseComplianceAction,
  FranchiseComplianceReminder,
  NetworkComplianceOverviewRow
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
  const documents = franchiseDocumentsFor(data, franchise);
  const insurancePolicies = (data.insurancePolicies ?? []).filter(
    (policy) => policy.franchiseId === franchise.id && !policy.deletedAt
  );
  const compliance = complianceSummaryFor(data, franchise, documents);
  const complianceActions = (data.complianceActions ?? []).filter(
    (action) => action.franchiseId === franchise.id && !action.deletedAt
  );
  const complianceReminders = (data.complianceReminders ?? []).filter(
    (reminder) => reminder.franchiseId === franchise.id && !reminder.deletedAt
  );

  return {
    franchise,
    organisation,
    territory,
    owner,
    contacts,
    agreement,
    documents,
    insurancePolicies,
    compliance,
    complianceActions,
    complianceReminders,
    activity: (data.activity ?? []).filter(
      (event) => event.entityType === "franchise" && event.entityId === franchise.id
    ),
    placeholders: {
      performance: "deferred",
      training: "deferred",
      support: "deferred"
    }
  };
}

export function listNetworkComplianceOverview(
  context: FranchiseActorContext,
  permissions: PermissionData,
  data: FranchiseData
): NetworkComplianceOverviewRow[] {
  requirePermission(permissionRequest(context, undefined, "complianceViewNetwork"), permissions);
  return listActiveFranchises(context, permissions, data).map((franchise) => {
    const documents = franchiseDocumentsFor(data, franchise);
    const compliance = complianceSummaryFor(data, franchise, documents);
    const openActions = (data.complianceActions ?? []).filter(
      (action) =>
        action.franchiseId === franchise.id &&
        action.status === "open" &&
        !action.deletedAt
    );

    return {
      franchise,
      organisation: data.organisations.find((organisation) => organisation.id === franchise.franchiseOrganisationId),
      territory: data.territories.find((territory) => territory.id === franchise.primaryTerritoryId),
      status: compliance.status,
      completeCount: compliance.completeCount,
      totalCount: compliance.totalCount,
      actionsRequired: compliance.actionsRequired,
      openActions: openActions.length,
      nextDueDate: openActions
        .map((action) => action.dueDate)
        .filter(Boolean)
        .sort()[0] ?? null
    };
  });
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

export async function uploadFranchiseDocument(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  input: {
    document: FranchiseDocument;
    version: FranchiseDocumentVersion;
    artifact: FranchiseArtifactReference;
  }
) {
  const franchise = requireFranchise(data, input.document.franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "documentUpload");
  assertDocumentScope(franchise, input.document);

  data.documents ??= [];
  data.documentVersions ??= [];
  data.artifactReferences ??= [];
  data.documents.push(input.document);
  data.documentVersions.push(input.version);
  data.artifactReferences.push({
    ...input.artifact,
    franchiseId: franchise.id,
    entityType: "franchise_document",
    entityId: input.document.id
  });

  await audit.record(documentAuditEvent(context, "franchise.document.upload", franchise, input.document));
  return input.document;
}

export async function addFranchiseDocumentVersion(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  input: {
    documentId: string;
    version: FranchiseDocumentVersion;
    artifact: FranchiseArtifactReference;
  }
) {
  const document = requireDocument(data, input.documentId);
  const franchise = requireFranchise(data, document.franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "documentUpload");
  const nextVersion = Math.max(
    0,
    ...(data.documentVersions ?? [])
      .filter((version) => version.documentId === document.id && !version.deletedAt)
      .map((version) => version.versionNumber)
  ) + 1;

  if (input.version.versionNumber !== nextVersion) {
    throw new Error("Document version numbers must be sequential.");
  }

  data.documentVersions ??= [];
  data.artifactReferences ??= [];
  data.documentVersions.push(input.version);
  data.artifactReferences.push({
    ...input.artifact,
    franchiseId: franchise.id,
    entityType: "franchise_document",
    entityId: document.id
  });
  document.currentVersionId = input.version.id;
  await audit.record(documentAuditEvent(context, "franchise.document.version.create", franchise, document));
  return document;
}

export async function archiveFranchiseDocument(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  documentId: string
) {
  const document = requireDocument(data, documentId);
  const franchise = requireFranchise(data, document.franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "documentArchive");
  document.status = "archived";
  document.archivedAt = today();
  document.deletedAt = new Date();
  await audit.record(documentAuditEvent(context, "franchise.document.archive", franchise, document));
  return document;
}

export async function upsertInsurancePolicy(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  input: FranchiseInsurancePolicy
) {
  const franchise = requireFranchise(data, input.franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "complianceSubmitEvidence");
  assertEvidenceDocumentBelongsToFranchise(data, franchise, input.evidenceDocumentId);

  data.insurancePolicies ??= [];
  const existingIndex = data.insurancePolicies.findIndex((policy) => policy.id === input.id);
  if (existingIndex >= 0) {
    data.insurancePolicies[existingIndex] = input;
  } else {
    data.insurancePolicies.push(input);
  }

  await audit.record(complianceAuditEvent(context, auditActions.franchiseInsuranceUpsert, franchise, "insurance_policy", input.id, {
    verificationStatus: input.verificationStatus,
    coverEndDate: input.coverEndDate
  }));
  return input;
}

export async function verifyInsurancePolicy(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  policyId: string,
  decision: { status: "verified" | "rejected"; rejectedReason?: string | null }
) {
  const policy = requireInsurancePolicy(data, policyId);
  const franchise = requireFranchise(data, policy.franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "complianceVerify");

  policy.verificationStatus = decision.status;
  policy.verifiedByUserId = context.userId;
  policy.verifiedAt = today();
  policy.rejectedReason = decision.status === "rejected" ? decision.rejectedReason ?? "Rejected" : null;

  await audit.record(complianceAuditEvent(
    context,
    decision.status === "verified" ? auditActions.franchiseInsuranceVerify : auditActions.franchiseInsuranceReject,
    franchise,
    "insurance_policy",
    policy.id,
    { verificationStatus: policy.verificationStatus, rejectedReason: policy.rejectedReason }
  ));
  return policy;
}

export async function createComplianceRequirement(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  input: NonNullable<FranchiseData["complianceRequirements"]>[number]
) {
  requirePermission(permissionRequest(context, context.territoryId, "complianceManageRequirements"), permissions);
  data.complianceRequirements ??= [];
  if (data.complianceRequirements.some((requirement) => requirement.key === input.key && !requirement.deletedAt)) {
    throw new Error("Compliance requirement key already exists.");
  }
  data.complianceRequirements.push(input);
  await audit.record(complianceAuditEvent(context, auditActions.franchiseComplianceRequirementCreate, undefined, "compliance_requirement", input.id, {
    key: input.key
  }));
  return input;
}

export async function submitComplianceEvidence(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  input: FranchiseComplianceRecord
) {
  const franchise = requireFranchise(data, input.franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "complianceSubmitEvidence");
  requireComplianceRequirement(data, input.requirementId);
  assertEvidenceDocumentBelongsToFranchise(data, franchise, input.evidenceDocumentId);

  input.status = "pending_review";
  data.complianceRecords ??= [];
  const existingIndex = data.complianceRecords.findIndex(
    (record) => record.franchiseId === input.franchiseId && record.requirementId === input.requirementId
  );
  if (existingIndex >= 0) {
    data.complianceRecords[existingIndex] = input;
  } else {
    data.complianceRecords.push(input);
  }

  await audit.record(complianceAuditEvent(context, auditActions.franchiseComplianceEvidenceSubmit, franchise, "franchise_compliance_record", input.id, {
    requirementId: input.requirementId,
    evidenceDocumentId: input.evidenceDocumentId
  }));
  return input;
}

export async function verifyComplianceRecord(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  recordId: string,
  decision: { status: "complete" | "rejected"; rejectedReason?: string | null }
) {
  const record = requireComplianceRecord(data, recordId);
  const franchise = requireFranchise(data, record.franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "complianceVerify");

  record.status = decision.status;
  record.verifiedByUserId = context.userId;
  record.verifiedAt = today();
  record.rejectedReason = decision.status === "rejected" ? decision.rejectedReason ?? "Rejected" : null;

  await audit.record(complianceAuditEvent(
    context,
    decision.status === "complete" ? auditActions.franchiseComplianceVerify : auditActions.franchiseComplianceReject,
    franchise,
    "franchise_compliance_record",
    record.id,
    { status: record.status, rejectedReason: record.rejectedReason }
  ));
  return record;
}

export async function ensureComplianceActions(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  franchiseId: string
) {
  const franchise = requireFranchise(data, franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "complianceManageActions");
  const view = getFranchise360(context, permissions, data, franchiseId);
  data.complianceActions ??= [];
  data.complianceReminders ??= [];
  const created: FranchiseComplianceAction[] = [];
  const reminders: FranchiseComplianceReminder[] = [];

  for (const requirement of view.compliance.requirements) {
    const status = requirement.record?.status ?? "missing";
    if (!["missing", "expired", "expiring_soon", "rejected"].includes(status)) {
      continue;
    }

    const idempotencyKey = `franchise:${franchise.id}:compliance:${requirement.id}:${status}`;
    let action = data.complianceActions.find(
      (candidate) => candidate.idempotencyKey === idempotencyKey && !candidate.deletedAt
    );
    if (!action) {
      action = {
        id: randomUUID(),
        franchiseId: franchise.id,
        complianceRecordId: requirement.record?.id ?? null,
        status: "open",
        severity: status === "expired" || status === "missing" ? "critical" : "warning",
        title: `${requirement.name}: ${status.replace("_", " ")}`,
        dueDate: requirement.record?.expiresAt ?? today(),
        idempotencyKey
      };
      data.complianceActions.push(action);
      created.push(action);
      await audit.record(complianceAuditEvent(context, auditActions.franchiseComplianceActionCreate, franchise, "franchise_compliance_action", action.id, {
        title: action.title,
        severity: action.severity,
        dueDate: action.dueDate
      }));
    }

    const reminderKey = `${idempotencyKey}:reminder`;
    if (!data.complianceReminders.some((candidate) => candidate.idempotencyKey === reminderKey && !candidate.deletedAt)) {
      const reminder = {
        id: randomUUID(),
        franchiseId: franchise.id,
        complianceActionId: action.id,
        reminderType: status,
        scheduledFor: action.dueDate ?? today(),
        status: "scheduled" as const,
        idempotencyKey: reminderKey
      };
      data.complianceReminders.push(reminder);
      reminders.push(reminder);
      await audit.record(complianceAuditEvent(context, auditActions.franchiseComplianceReminderSchedule, franchise, "franchise_compliance_reminder", reminder.id, {
        reminderType: reminder.reminderType,
        scheduledFor: reminder.scheduledFor
      }));
    }
  }

  return { actions: created, reminders };
}

export async function resolveComplianceAction(
  context: FranchiseActorContext,
  permissions: PermissionData,
  audit: FranchiseAuditRecorder,
  data: FranchiseData,
  actionId: string
) {
  const action = requireComplianceAction(data, actionId);
  const franchise = requireFranchise(data, action.franchiseId);
  requireFranchiseAccess(context, permissions, franchise, "complianceManageActions");
  action.status = "resolved";
  action.resolvedAt = today();
  await audit.record(complianceAuditEvent(context, auditActions.franchiseComplianceActionResolve, franchise, "franchise_compliance_action", action.id, {
    status: action.status,
    resolvedAt: action.resolvedAt
  }));
  return action;
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
  territoryId: string | undefined,
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

function requireDocument(data: FranchiseData, documentId: string) {
  const document = (data.documents ?? []).find(
    (candidate) => candidate.id === documentId && !candidate.deletedAt
  );

  if (!document) {
    throw new Error("Document was not found.");
  }

  return document;
}

function requireInsurancePolicy(data: FranchiseData, policyId: string) {
  const policy = (data.insurancePolicies ?? []).find(
    (candidate) => candidate.id === policyId && !candidate.deletedAt
  );
  if (!policy) {
    throw new Error("Insurance policy was not found.");
  }
  return policy;
}

function requireComplianceRequirement(data: FranchiseData, requirementId: string) {
  const requirement = (data.complianceRequirements ?? []).find(
    (candidate) => candidate.id === requirementId && !candidate.deletedAt && candidate.active
  );
  if (!requirement) {
    throw new Error("Compliance requirement was not found.");
  }
  return requirement;
}

function requireComplianceRecord(data: FranchiseData, recordId: string) {
  const record = (data.complianceRecords ?? []).find(
    (candidate) => candidate.id === recordId && !candidate.deletedAt
  );
  if (!record) {
    throw new Error("Compliance record was not found.");
  }
  return record;
}

function requireComplianceAction(data: FranchiseData, actionId: string) {
  const action = (data.complianceActions ?? []).find(
    (candidate) => candidate.id === actionId && !candidate.deletedAt
  );
  if (!action) {
    throw new Error("Compliance action was not found.");
  }
  return action;
}

function assertDocumentScope(franchise: FranchiseRecord, document: FranchiseDocument) {
  if (
    document.franchiseId !== franchise.id ||
    document.organisationId !== franchise.franchiseOrganisationId ||
    document.territoryId !== franchise.primaryTerritoryId
  ) {
    throw new Error("Document scope does not match the franchise relationship.");
  }
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

function franchiseDocumentsFor(data: FranchiseData, franchise: FranchiseRecord) {
  return (data.documents ?? [])
    .filter(
      (document) =>
        document.franchiseId === franchise.id &&
        document.status !== "archived" &&
        !document.deletedAt
    )
    .map((document) => {
      const versions = (data.documentVersions ?? [])
        .filter((version) => version.documentId === document.id && !version.deletedAt)
        .sort((left, right) => right.versionNumber - left.versionNumber)
        .map((version) => ({
          ...version,
          artifact: (data.artifactReferences ?? []).find(
            (artifact) => artifact.id === version.artifactReferenceId
          )
        }));
      const currentVersion =
        versions.find((version) => version.id === document.currentVersionId) ?? versions[0];

      return {
        ...document,
        currentVersion,
        artifact: currentVersion?.artifact,
        versions
      };
    });
}

function complianceSummaryFor(
  data: FranchiseData,
  franchise: FranchiseRecord,
  documents: ReturnType<typeof franchiseDocumentsFor>
) {
  const todayDate = new Date(today());
  const requirements = (data.complianceRequirements ?? [])
    .filter((requirement) => requirement.active && !requirement.deletedAt)
    .map((requirement) => {
      const record = (data.complianceRecords ?? []).find(
        (candidate) =>
          candidate.franchiseId === franchise.id &&
          candidate.requirementId === requirement.id &&
          !candidate.deletedAt
      );
      const status: ComplianceRecordStatus = record
        ? calculatedComplianceStatus(requirement.expiryWarningDays, record, todayDate)
        : "missing";
      return {
        ...requirement,
        record: record ? { ...record, status } : undefined,
        evidence: record?.evidenceDocumentId
          ? documents.find((document) => document.id === record.evidenceDocumentId)
          : undefined
      };
    });

  const totalCount = requirements.length;
  const completeCount = requirements.filter((requirement) => requirement.record?.status === "complete").length;
  const actionsRequired = requirements.filter((requirement) =>
    ["missing", "expired", "expiring_soon", "rejected"].includes(requirement.record?.status ?? "missing")
  ).length;
  const statuses = requirements.map((requirement) => requirement.record?.status ?? "missing");
  const status: ComplianceRecordStatus = statuses.includes("expired")
    ? "expired"
    : statuses.includes("rejected")
      ? "rejected"
      : statuses.includes("missing")
        ? "missing"
        : statuses.includes("expiring_soon")
          ? "expiring_soon"
          : statuses.includes("pending_review")
            ? "pending_review"
            : "complete";

  return { requirements, status, completeCount, totalCount, actionsRequired };
}

function calculatedComplianceStatus(
  expiryWarningDays: number,
  record: FranchiseComplianceRecord,
  todayDate: Date
): ComplianceRecordStatus {
  if (record.status !== "complete" || !record.expiresAt) {
    return record.status;
  }
  const expiryDate = new Date(`${record.expiresAt}T00:00:00.000Z`);
  const warningDate = new Date(todayDate);
  warningDate.setUTCDate(warningDate.getUTCDate() + expiryWarningDays);
  if (expiryDate < todayDate) {
    return "expired";
  }
  return expiryDate <= warningDate ? "expiring_soon" : "complete";
}

function assertEvidenceDocumentBelongsToFranchise(
  data: FranchiseData,
  franchise: FranchiseRecord,
  documentId?: string | null
) {
  if (!documentId) {
    return;
  }
  const document = requireDocument(data, documentId);
  assertDocumentScope(franchise, document);
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

function documentAuditEvent(
  context: FranchiseActorContext,
  action:
    | "franchise.document.upload"
    | "franchise.document.version.create"
    | "franchise.document.archive",
  franchise: FranchiseRecord,
  document: FranchiseDocument
): RecordAuditEventInput {
  return {
    action,
    actor: {
      type: "human",
      userId: context.userId
    },
    entity: {
      type: "franchise_document",
      id: document.id
    },
    scope: {
      organisationId: franchise.franchiseOrganisationId,
      territoryId: franchise.primaryTerritoryId
    },
    after: {
      status: document.status,
      category: document.category,
      documentType: document.documentType,
      currentVersionId: document.currentVersionId
    },
    metadata: {
      franchiseId: franchise.id,
      source: "franchise_360"
    }
  };
}

function complianceAuditEvent(
  context: FranchiseActorContext,
  action: string,
  franchise: FranchiseRecord | undefined,
  entityType: string,
  entityId: string,
  after: Record<string, unknown>
): RecordAuditEventInput {
  return {
    action,
    actor: {
      type: "human",
      userId: context.userId
    },
    entity: {
      type: entityType,
      id: entityId
    },
    scope: {
      organisationId: franchise?.franchiseOrganisationId ?? context.organisationId,
      territoryId: franchise?.primaryTerritoryId ?? context.territoryId
    },
    after,
    metadata: {
      franchiseId: franchise?.id,
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
  agreementExecuted: auditActions.franchiseAgreementExecuted,
  documentUpload: auditActions.franchiseDocumentUpload,
  documentVersionCreate: auditActions.franchiseDocumentVersionCreate,
  documentArchive: auditActions.franchiseDocumentArchive
} as const;
