import {
  activeAgreementForFranchise,
  addFranchiseDocumentVersion,
  archiveFranchiseDocument,
  archiveFranchiseDocumentRecord,
  approveAgreement,
  approveLaunch,
  approveOnboardingTask,
  cancelSignatureRequest,
  changeOnboardingTargetLaunchDate,
  completeOnboardingTask,
  ensureComplianceActions,
  submitComplianceEvidence,
  insertComplianceActionRecords,
  insertComplianceReminderRecords,
  upsertComplianceRecord,
  upsertInsurancePolicy,
  upsertInsurancePolicyRecord,
  verifyComplianceRecord,
  verifyInsurancePolicy,
  generateAgreement,
  createFranchise,
  getFranchise360,
  insertFranchiseAgreement,
  insertFranchiseDocumentGraph,
  insertFranchiseDocumentVersionGraph,
  insertFranchiseRecord,
  insertDomainEvents,
  insertOnboardingBlockerRecord,
  insertOnboardingProgrammeGraph,
  insertSignatureRequest,
  insertSigners,
  latestApprovedAgreementVersionId,
  listActiveFranchises,
  listNetworkComplianceOverview,
  listNetworkOnboardingOverview,
  loadFranchiseData,
  manuallyCreateOnboardingProgramme,
  markFranchiseLaunched,
  raiseOnboardingBlocker,
  recordSignatureProviderEvent,
  resendSignatureRequest,
  resolveComplianceAction,
  resolveOnboardingBlocker,
  sendAgreementForSignature,
  submitAgreementForApproval,
  syncSignatureRequestGraph,
  updateFranchiseAgreementState,
  updateComplianceActionRecord,
  updateFranchiseRecord,
  updateOnboardingBlockerRecord,
  updateOnboardingProgrammeRecord,
  updateOnboardingTaskRecord,
  voidAgreement,
  startOnboardingFromExecutedAgreement,
  uploadFranchiseDocument,
  updateFranchise
} from "@raring2go/franchise";
import { recordAuditEvent } from "@raring2go/audit";
import { evaluatePermission } from "@raring2go/permissions";
import { createDb, users } from "@raring2go/db";
import { eq } from "drizzle-orm";
import { createFileReference } from "@raring2go/storage";
import type {
  AgreementSigner,
  ESignProvider,
  Franchise360,
  FranchiseActorContext,
  FranchiseArtifactReference,
  FranchiseDocument,
  FranchiseDocumentVersion,
  FranchiseComplianceRecord,
  FranchiseInsurancePolicy,
  FranchiseRecord
} from "@raring2go/franchise";
import type { PermissionData } from "@raring2go/permissions";
import { getPermissionData } from "./permission-source";

export async function listFranchiseSummaries(context: FranchiseActorContext) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return listActiveFranchises(
      context,
      franchisePermissionData,
      await loadFranchiseData(db)
    );
  } finally {
    await sql.end();
  }
}

export async function listComplianceOverview(context: FranchiseActorContext) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return listNetworkComplianceOverview(
      context,
      franchisePermissionData,
      await loadFranchiseData(db)
    );
  } finally {
    await sql.end();
  }
}

export async function listOnboardingOverview(context: FranchiseActorContext) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return listNetworkOnboardingOverview(
      context,
      franchisePermissionData,
      await loadFranchiseData(db)
    );
  } finally {
    await sql.end();
  }
}

export async function readFranchise360(
  context: FranchiseActorContext,
  franchiseId: string
): Promise<Franchise360> {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return getFranchise360(
      context,
      franchisePermissionData,
      await loadFranchiseData(db),
      franchiseId
    );
  } finally {
    await sql.end();
  }
}

export function canEditFranchise(permissions: PermissionData, context: FranchiseActorContext) {
  return evaluatePermission(
    {
      userId: context.userId,
      module: "franchise",
      action: "edit",
      context
    },
    permissions
  ).allowed;
}

export async function createFranchiseFromInput(
  context: FranchiseActorContext,
  input: FranchiseRecord
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      const created = await createFranchise(context, franchisePermissionData, auditFor(tx), data, input);
      await insertFranchiseRecord(tx, created);
      return created;
    });
  } finally {
    await sql.end();
  }
}

export async function updateFranchiseFromInput(
  context: FranchiseActorContext,
  franchiseId: string,
  patch: Parameters<typeof updateFranchise>[4]["patch"]
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      const updated = await updateFranchise(context, franchisePermissionData, auditFor(tx), data, {
        franchiseId,
        patch
      });
      await updateFranchiseRecord(tx, franchiseId, patch);
      return updated;
    });
  } finally {
    await sql.end();
  }
}

export async function generateAgreementForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  agreementId: string
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      const view = getFranchise360(context, franchisePermissionData, data, franchiseId);
      const versionId = await latestApprovedAgreementVersionId(tx);
      const agreement = await generateAgreement(context, franchisePermissionData, auditFor(tx), data, {
        id: agreementId,
        franchiseId,
        agreementVersionId: versionId,
        mergeVariables: {
          franchiseOrganisationName: view.organisation.name,
          territoryName: view.territory.name,
          ownerName: view.owner?.displayName ?? "Unassigned",
          launchDate: view.franchise.launchDate ?? "",
          renewalDate: view.franchise.renewalDate ?? ""
        }
      });
      await insertFranchiseAgreement(tx, agreement);
      return agreement;
    });
  } finally {
    await sql.end();
  }
}

export async function submitCurrentAgreement(
  context: FranchiseActorContext,
  franchiseId: string
) {
  return mutateCurrentAgreement(context, franchiseId, submitAgreementForApproval);
}

export async function approveCurrentAgreement(
  context: FranchiseActorContext,
  franchiseId: string
) {
  return mutateCurrentAgreement(context, franchiseId, approveAgreement);
}

export async function voidCurrentAgreement(
  context: FranchiseActorContext,
  franchiseId: string
) {
  return mutateCurrentAgreement(context, franchiseId, voidAgreement);
}

export async function sendCurrentAgreementForSignature(
  context: FranchiseActorContext,
  franchiseId: string,
  requestId: string
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const current = await activeAgreementForFranchise(tx, franchiseId);

      if (!current) {
        throw new Error("No active agreement is available.");
      }

      const data = await loadFranchiseData(tx);
      const view = getFranchise360(context, franchisePermissionData, data, franchiseId);
      const request = await sendAgreementForSignature(
        context,
        franchisePermissionData,
        auditFor(tx),
        data,
        eSignProvider(),
        {
          requestId,
          agreementId: current.id,
          signers: await defaultSigners(tx, requestId, view, context.userId)
        }
      );
      await updateFranchiseAgreementState(tx, data.franchiseAgreements!.find((agreement) => agreement.id === current.id)!);
      await insertSignatureRequest(tx, request);
      await insertSigners(tx, data.signers!.filter((signer) => signer.signatureRequestId === request.id));
      return request;
    });
  } finally {
    await sql.end();
  }
}

export async function resendCurrentSignatureRequest(
  context: FranchiseActorContext,
  franchiseId: string
) {
  const franchisePermissionData = await getPermissionData();
  return mutateCurrentSignatureRequest(context, franchiseId, (data, requestId, tx) =>
    resendSignatureRequest(
      context,
      franchisePermissionData,
      auditFor(tx),
      data,
      eSignProvider(),
      requestId
    )
  );
}

export async function cancelCurrentSignatureRequest(
  context: FranchiseActorContext,
  franchiseId: string
) {
  const franchisePermissionData = await getPermissionData();
  return mutateCurrentSignatureRequest(context, franchiseId, (data, requestId, tx) =>
    cancelSignatureRequest(
      context,
      franchisePermissionData,
      auditFor(tx),
      data,
      eSignProvider(),
      requestId
    )
  );
}

export async function completeNextSignerForCurrentAgreement(
  context: FranchiseActorContext,
  franchiseId: string,
  eventId: string
) {
  return recordCurrentSignatureEvent(context, franchiseId, eventId, "signer.completed");
}

export async function completeCurrentAgreementSigning(
  context: FranchiseActorContext,
  franchiseId: string,
  eventId: string
) {
  return recordCurrentSignatureEvent(context, franchiseId, eventId, "completed");
}

export async function declineCurrentAgreementSigning(
  context: FranchiseActorContext,
  franchiseId: string,
  eventId: string
) {
  return recordCurrentSignatureEvent(context, franchiseId, eventId, "declined");
}

export async function uploadDocumentForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  input: {
    documentId: string;
    versionId: string;
    artifactId: string;
    category: string;
    documentType: string;
    title: string;
    description?: string | null;
    expiryDate?: string | null;
  }
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      const view = getFranchise360(context, franchisePermissionData, data, franchiseId);
      const document: FranchiseDocument = {
        id: input.documentId,
        franchiseId,
        organisationId: view.franchise.franchiseOrganisationId,
        territoryId: view.franchise.primaryTerritoryId,
        category: input.category,
        documentType: input.documentType,
        title: input.title,
        description: input.description ?? null,
        status: "active",
        currentVersionId: input.versionId,
        expiryDate: input.expiryDate ?? null,
        uploadedByUserId: context.userId
      };
      const version: FranchiseDocumentVersion = {
        id: input.versionId,
        documentId: input.documentId,
        versionNumber: 1,
        artifactReferenceId: input.artifactId,
        uploadedByUserId: context.userId,
        uploadedAt: today()
      };
      const artifact: FranchiseArtifactReference = documentArtifact(
        input.artifactId,
        franchiseId,
        territoryIdForFranchise(data, franchiseId),
        input.documentId,
        input.title,
        context.userId
      );
      const uploaded = await uploadFranchiseDocument(
        context,
        franchisePermissionData,
        auditFor(tx),
        data,
        { document, version, artifact }
      );
      await insertFranchiseDocumentGraph(tx, { document, version, artifact });
      return uploaded;
    });
  } finally {
    await sql.end();
  }
}

export async function addDocumentVersionForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  documentId: string,
  versionId: string,
  artifactId: string
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      getFranchise360(context, franchisePermissionData, data, franchiseId);
      const existingVersions = (data.documentVersions ?? []).filter(
        (version) => version.documentId === documentId
      );
      const version: FranchiseDocumentVersion = {
        id: versionId,
        documentId,
        versionNumber: existingVersions.length + 1,
        artifactReferenceId: artifactId,
        uploadedByUserId: context.userId,
        uploadedAt: today()
      };
      const artifact = documentArtifact(artifactId, franchiseId, territoryIdForFranchise(data, franchiseId), documentId, "Document version", context.userId);
      const document = await addFranchiseDocumentVersion(
        context,
        franchisePermissionData,
        auditFor(tx),
        data,
        { documentId, version, artifact }
      );
      await insertFranchiseDocumentVersionGraph(tx, { document, version, artifact });
      return document;
    });
  } finally {
    await sql.end();
  }
}

export async function archiveDocumentForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  documentId: string
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      getFranchise360(context, franchisePermissionData, data, franchiseId);
      const document = await archiveFranchiseDocument(
        context,
        franchisePermissionData,
        auditFor(tx),
        data,
        documentId
      );
      await archiveFranchiseDocumentRecord(tx, document);
      return document;
    });
  } finally {
    await sql.end();
  }
}

export async function upsertInsuranceForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  input: {
    policyId: string;
    provider: string;
    policyNumber: string;
    coverTypes: string[];
    coverStartDate: string;
    coverEndDate: string;
    evidenceDocumentId?: string | null;
  }
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      getFranchise360(context, franchisePermissionData, data, franchiseId);
      const policy: FranchiseInsurancePolicy = {
        id: input.policyId,
        franchiseId,
        provider: input.provider,
        policyNumber: input.policyNumber,
        coverTypes: input.coverTypes,
        coverStartDate: input.coverStartDate,
        coverEndDate: input.coverEndDate,
        evidenceDocumentId: input.evidenceDocumentId ?? null,
        verificationStatus: "pending"
      };
      const upserted = await upsertInsurancePolicy(
        context,
        franchisePermissionData,
        auditFor(tx),
        data,
        policy
      );
      await upsertInsurancePolicyRecord(tx, upserted);
      return upserted;
    });
  } finally {
    await sql.end();
  }
}

export async function verifyInsuranceForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  policyId: string,
  status: "verified" | "rejected"
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      getFranchise360(context, franchisePermissionData, data, franchiseId);
      const policy = await verifyInsurancePolicy(context, franchisePermissionData, auditFor(tx), data, policyId, {
        status,
        rejectedReason: status === "rejected" ? "Rejected during HQ review." : null
      });
      await upsertInsurancePolicyRecord(tx, policy);
      return policy;
    });
  } finally {
    await sql.end();
  }
}

export async function submitComplianceEvidenceForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  input: {
    recordId: string;
    requirementId: string;
    evidenceDocumentId?: string | null;
    expiresAt?: string | null;
  }
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      getFranchise360(context, franchisePermissionData, data, franchiseId);
      const record: FranchiseComplianceRecord = {
        id: input.recordId,
        franchiseId,
        requirementId: input.requirementId,
        evidenceDocumentId: input.evidenceDocumentId ?? null,
        status: "pending_review",
        expiresAt: input.expiresAt ?? null
      };
      const submitted = await submitComplianceEvidence(
        context,
        franchisePermissionData,
        auditFor(tx),
        data,
        record
      );
      await upsertComplianceRecord(tx, submitted);
      return submitted;
    });
  } finally {
    await sql.end();
  }
}

export async function verifyComplianceForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  recordId: string,
  status: "complete" | "rejected"
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      getFranchise360(context, franchisePermissionData, data, franchiseId);
      const record = await verifyComplianceRecord(context, franchisePermissionData, auditFor(tx), data, recordId, {
        status,
        rejectedReason: status === "rejected" ? "Rejected during HQ review." : null
      });
      await upsertComplianceRecord(tx, record);
      return record;
    });
  } finally {
    await sql.end();
  }
}

export async function ensureComplianceActionsForFranchise(
  context: FranchiseActorContext,
  franchiseId: string
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      const result = await ensureComplianceActions(
        context,
        franchisePermissionData,
        auditFor(tx),
        data,
        franchiseId
      );
      await insertComplianceActionRecords(tx, result.actions);
      await insertComplianceReminderRecords(tx, result.reminders);
      return result;
    });
  } finally {
    await sql.end();
  }
}

export async function resolveComplianceActionForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  actionId: string
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      getFranchise360(context, franchisePermissionData, data, franchiseId);
      const action = await resolveComplianceAction(
        context,
        franchisePermissionData,
        auditFor(tx),
        data,
        actionId
      );
      await updateComplianceActionRecord(tx, action);
      return action;
    });
  } finally {
    await sql.end();
  }
}

export async function startOnboardingForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  targetLaunchDate: string
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      const view = getFranchise360(context, franchisePermissionData, data, franchiseId);
      const agreementId = view.agreement?.id;
      const result = agreementId && view.agreement?.status === "executed"
        ? await startOnboardingFromExecutedAgreement(context, franchisePermissionData, auditFor(tx), data, agreementId, {
            targetLaunchDate
          })
        : await manuallyCreateOnboardingProgramme(context, franchisePermissionData, auditFor(tx), data, franchiseId, {
            targetLaunchDate
          });
      await insertOnboardingProgrammeGraph(tx, result.programme, result.tasks);
      await insertDomainEvents(tx, data.domainEvents ?? []);
      await updateFranchiseRecord(tx, franchiseId, data.franchises.find((franchise) => franchise.id === franchiseId)!);
      return result;
    });
  } finally {
    await sql.end();
  }
}

export async function completeOnboardingTaskForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  taskId: string
) {
  return mutateOnboardingTask(context, franchiseId, taskId, completeOnboardingTask);
}

export async function approveOnboardingTaskForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  taskId: string
) {
  return mutateOnboardingTask(context, franchiseId, taskId, approveOnboardingTask);
}

export async function changeOnboardingTargetForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  programmeId: string,
  targetLaunchDate: string
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      getFranchise360(context, franchisePermissionData, data, franchiseId);
      const programme = await changeOnboardingTargetLaunchDate(context, franchisePermissionData, auditFor(tx), data, programmeId, targetLaunchDate);
      await updateOnboardingProgrammeRecord(tx, programme);
      for (const task of data.onboardingTasks?.filter((candidate) => candidate.programmeId === programme.id) ?? []) {
        await updateOnboardingTaskRecord(tx, task);
      }
      await insertDomainEvents(tx, data.domainEvents ?? []);
      return programme;
    });
  } finally {
    await sql.end();
  }
}

export async function raiseOnboardingBlockerForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  taskId: string,
  input: {
    title: string;
    notes?: string | null;
  }
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      const view = getFranchise360(context, franchisePermissionData, data, franchiseId);
      if (!view.onboarding.tasks.some((task) => task.id === taskId)) {
        throw new Error("Onboarding task is outside this franchise.");
      }
      const result = await raiseOnboardingBlocker(context, franchisePermissionData, auditFor(tx), data, taskId, input);
      await updateOnboardingTaskRecord(tx, result.task);
      await updateOnboardingProgrammeRecord(tx, result.programme);
      await insertOnboardingBlockerRecord(tx, result.blocker);
      await insertDomainEvents(tx, data.domainEvents ?? []);
      return result;
    });
  } finally {
    await sql.end();
  }
}

export async function resolveOnboardingBlockerForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  blockerId: string
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      const view = getFranchise360(context, franchisePermissionData, data, franchiseId);
      if (!view.onboarding.blockers.some((blocker) => blocker.id === blockerId)) {
        throw new Error("Onboarding blocker is outside this franchise.");
      }
      const result = await resolveOnboardingBlocker(context, franchisePermissionData, auditFor(tx), data, blockerId);
      await updateOnboardingBlockerRecord(tx, result.blocker);
      await updateOnboardingProgrammeRecord(tx, result.programme);
      await insertDomainEvents(tx, data.domainEvents ?? []);
      return result;
    });
  } finally {
    await sql.end();
  }
}

export async function approveLaunchForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  programmeId: string
) {
  return mutateOnboardingProgramme(context, franchiseId, programmeId, approveLaunch);
}

export async function markLaunchedForFranchise(
  context: FranchiseActorContext,
  franchiseId: string,
  programmeId: string
) {
  return mutateOnboardingProgramme(context, franchiseId, programmeId, markFranchiseLaunched);
}

async function mutateOnboardingTask(
  context: FranchiseActorContext,
  franchiseId: string,
  taskId: string,
  mutation: typeof completeOnboardingTask | typeof approveOnboardingTask
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      getFranchise360(context, franchisePermissionData, data, franchiseId);
      const task = await mutation(context, franchisePermissionData, auditFor(tx), data, taskId);
      const programme = data.onboardingProgrammes!.find((candidate) => candidate.id === task.programmeId)!;
      await updateOnboardingTaskRecord(tx, task);
      await updateOnboardingProgrammeRecord(tx, programme);
      await insertDomainEvents(tx, data.domainEvents ?? []);
      return task;
    });
  } finally {
    await sql.end();
  }
}

async function mutateOnboardingProgramme(
  context: FranchiseActorContext,
  franchiseId: string,
  programmeId: string,
  mutation: typeof approveLaunch | typeof markFranchiseLaunched
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFranchiseData(tx);
      getFranchise360(context, franchisePermissionData, data, franchiseId);
      const programme = await mutation(context, franchisePermissionData, auditFor(tx), data, programmeId);
      await updateOnboardingProgrammeRecord(tx, programme);
      await updateFranchiseRecord(tx, franchiseId, data.franchises.find((franchise) => franchise.id === franchiseId)!);
      await insertDomainEvents(tx, data.domainEvents ?? []);
      return programme;
    });
  } finally {
    await sql.end();
  }
}

async function recordCurrentSignatureEvent(
  context: FranchiseActorContext,
  franchiseId: string,
  eventId: string,
  eventType: "signer.completed" | "declined" | "expired" | "cancelled" | "completed"
) {
  const franchisePermissionData = await getPermissionData();
  return mutateCurrentSignatureRequest(context, franchiseId, (data, requestId, tx) =>
    recordSignatureProviderEvent(
      context,
      franchisePermissionData,
      auditFor(tx),
      data,
      {
        eventId,
        requestId,
        eventType,
        signedAgreementArtifact:
          eventType === "completed" ? signedArtifact(franchiseId, territoryIdForFranchise(data, franchiseId), eventId, agreementIdForRequest(data, requestId)) : undefined,
        completionCertificateArtifact:
          eventType === "completed" ? certificateArtifact(franchiseId, territoryIdForFranchise(data, franchiseId), eventId, agreementIdForRequest(data, requestId)) : undefined,
        payload: {
          source: "development_esign_provider"
        }
      }
    )
  );
}

async function mutateCurrentSignatureRequest<T>(
  context: FranchiseActorContext,
  franchiseId: string,
  mutation: (data: Awaited<ReturnType<typeof loadFranchiseData>>, requestId: string, tx: Parameters<typeof recordAuditEvent>[0]) => Promise<T>
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const current = await activeAgreementForFranchise(tx, franchiseId);

      if (!current) {
        throw new Error("No active agreement is available.");
      }

      const data = await loadFranchiseData(tx);
      const view = getFranchise360(context, franchisePermissionData, data, franchiseId);
      const requestId = view.agreement?.signatureRequest?.id;

      if (!requestId) {
        throw new Error("No active signature request is available.");
      }

      const result = await mutation(data, requestId, tx);
      const agreement = data.franchiseAgreements!.find((candidate) => candidate.id === current.id)!;
      await updateFranchiseAgreementState(tx, agreement);
      await syncSignatureRequestGraph(tx, data, requestId);
      return result;
    });
  } finally {
    await sql.end();
  }
}

async function mutateCurrentAgreement(
  context: FranchiseActorContext,
  franchiseId: string,
  mutation: typeof submitAgreementForApproval | typeof approveAgreement | typeof voidAgreement
) {
  const franchisePermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const current = await activeAgreementForFranchise(tx, franchiseId);

      if (!current) {
        throw new Error("No active agreement is available.");
      }

      const data = await loadFranchiseData(tx);
      const agreement = await mutation(
        context,
        franchisePermissionData,
        auditFor(tx),
        data,
        current.id
      );
      await updateFranchiseAgreementState(tx, agreement);
      return agreement;
    });
  } finally {
    await sql.end();
  }
}

function auditFor(db: Parameters<typeof recordAuditEvent>[0]) {
  return {
    record: (input: Parameters<typeof recordAuditEvent>[1]) =>
      recordAuditEvent(db, input).then(() => undefined)
  };
}

/**
 * No real e-signature provider is wired yet (UAT-002 chooses one). The development
 * provider only records requests locally, so it must never run against production:
 * outside development this fails closed instead of pretending documents were sent.
 */
export function eSignProvider(): ESignProvider {
  if (process.env.NODE_ENV === "production") {
    throw new Error("No e-signature provider is configured; the development provider is not available in production.");
  }
  return developmentESignProvider;
}

const developmentESignProvider: ESignProvider = {
  key: "development",
  async send(input) {
    return {
      providerRequestId: `dev-${input.agreementId}`,
      metadata: {
        signerCount: input.signers.length
      }
    };
  },
  async resend() {
    return { metadata: { resent: true } };
  },
  async cancel() {
    return { metadata: { cancelled: true } };
  }
};

async function defaultSigners(
  db: Pick<ReturnType<typeof createDb>["db"], "select">,
  requestId: string,
  view: Franchise360,
  franchisorUserId: string
): Promise<Array<Omit<AgreementSigner, "signatureRequestId" | "status">>> {
  if (!view.owner?.email) {
    throw new Error("The franchise has no owner with an email address to sign the agreement.");
  }
  const [franchisor] = await db.select().from(users).where(eq(users.id, franchisorUserId)).limit(1);
  if (!franchisor?.email) {
    throw new Error("The sending user has no email address to sign for the franchisor.");
  }

  return [
    {
      id: `${requestId}-franchisee`,
      role: "franchisee",
      userId: view.owner.id,
      name: view.owner.displayName ?? view.owner.email,
      email: view.owner.email,
      signingOrder: 1,
      required: true
    },
    {
      id: `${requestId}-franchisor`,
      role: "franchisor",
      userId: franchisor.id,
      name: franchisor.displayName ?? franchisor.email,
      email: franchisor.email,
      signingOrder: 2,
      required: true
    }
  ];
}

function agreementIdForRequest(data: Awaited<ReturnType<typeof loadFranchiseData>>, requestId: string) {
  const request = (data.signatureRequests ?? []).find((candidate) => candidate.id === requestId);
  if (!request) throw new Error("The signature request was not found.");
  return request.franchiseAgreementId;
}

function signedArtifact(franchiseId: string, territoryId: string | null, eventId: string, agreementId: string) {
  const file = createFileReference({
    id: `${eventId}-signed-file`,
    storageKey: `development/franchise-agreements/${eventId}/signed.pdf`,
    fileName: "signed-franchise-agreement.pdf",
    contentType: "application/pdf",
    accessScope: "territory",
    territoryId,
    lockedAt: today()
  });

  return {
    id: `${eventId}-signed`,
    franchiseId,
    entityType: "franchise_agreement",
    entityId: agreementId,
    category: "signed_agreement" as const,
    label: "Signed franchise agreement",
    storageKey: file.storageKey,
    contentType: file.contentType,
    providerMetadata: {
      provider: file.providerKey,
      storage: file
    }
  };
}

function certificateArtifact(franchiseId: string, territoryId: string | null, eventId: string, agreementId: string) {
  const file = createFileReference({
    id: `${eventId}-certificate-file`,
    storageKey: `development/franchise-agreements/${eventId}/certificate.pdf`,
    fileName: "completion-certificate.pdf",
    contentType: "application/pdf",
    accessScope: "territory",
    territoryId,
    lockedAt: today()
  });

  return {
    id: `${eventId}-certificate`,
    franchiseId,
    entityType: "franchise_agreement",
    entityId: agreementId,
    category: "completion_certificate" as const,
    label: "Completion certificate",
    storageKey: file.storageKey,
    contentType: file.contentType,
    providerMetadata: {
      provider: file.providerKey,
      storage: file
    }
  };
}

function documentArtifact(
  artifactId: string,
  franchiseId: string,
  territoryId: string | null,
  documentId: string,
  title: string,
  ownerUserId: string
): FranchiseArtifactReference {
  const file = createFileReference({
    id: `${artifactId}-file`,
    storageKey: `development/franchise-documents/${documentId}/${artifactId}.pdf`,
    fileName: `${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "document"}.pdf`,
    contentType: "application/pdf",
    accessScope: "territory",
    territoryId,
    ownerUserId
  });

  return {
    id: artifactId,
    franchiseId,
    entityType: "franchise_document",
    entityId: documentId,
    category: "vault_document",
    label: title,
    storageKey: file.storageKey,
    contentType: file.contentType,
    providerMetadata: {
      provider: file.providerKey,
      storage: file
    }
  };
}

/** A franchise's home territory, from the franchise data already loaded for the operation. */
function territoryIdForFranchise(data: { franchises: Array<{ id: string; primaryTerritoryId: string }> }, franchiseId: string) {
  return data.franchises.find((franchise) => franchise.id === franchiseId)?.primaryTerritoryId ?? null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
