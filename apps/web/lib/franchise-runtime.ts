import {
  activeAgreementForFranchise,
  addFranchiseDocumentVersion,
  archiveFranchiseDocument,
  archiveFranchiseDocumentRecord,
  approveAgreement,
  cancelSignatureRequest,
  generateAgreement,
  createFranchise,
  getFranchise360,
  insertFranchiseAgreement,
  insertFranchiseDocumentGraph,
  insertFranchiseDocumentVersionGraph,
  insertFranchiseRecord,
  insertSignatureRequest,
  insertSigners,
  latestApprovedAgreementVersionId,
  listActiveFranchises,
  loadFranchiseData,
  recordSignatureProviderEvent,
  resendSignatureRequest,
  sendAgreementForSignature,
  submitAgreementForApproval,
  syncSignatureRequestGraph,
  updateFranchiseAgreementState,
  updateFranchiseRecord,
  voidAgreement,
  uploadFranchiseDocument,
  updateFranchise
} from "@raring2go/franchise";
import { recordAuditEvent } from "@raring2go/audit";
import { evaluatePermission } from "@raring2go/permissions";
import { createDb, fixtureIds, foundationSeed } from "@raring2go/db";
import type {
  AgreementSigner,
  ESignProvider,
  Franchise360,
  FranchiseActorContext,
  FranchiseArtifactReference,
  FranchiseDocument,
  FranchiseDocumentVersion,
  FranchiseRecord
} from "@raring2go/franchise";
import type { PermissionData } from "@raring2go/permissions";

export const franchisePermissionData: PermissionData = {
  roleAssignments: [
    {
      id: "fixture_assignment_superadmin",
      userId: fixtureIds.users.superAdmin,
      roleId: fixtureIds.roles.superAdmin,
      organisationId: fixtureIds.organisations.hq
    },
    {
      id: "fixture_assignment_hq",
      userId: fixtureIds.users.superAdmin,
      roleId: fixtureIds.roles.hqAdmin,
      organisationId: fixtureIds.organisations.hq
    },
    {
      id: "fixture_assignment_franchisee",
      userId: fixtureIds.users.franchisee,
      roleId: fixtureIds.roles.franchisee,
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield
    }
  ],
  rolePermissions: [
    {
      roleId: fixtureIds.roles.hqAdmin,
      permissionId: fixtureIds.permissions.franchiseView,
      scope: "network"
    },
    {
      roleId: fixtureIds.roles.hqAdmin,
      permissionId: fixtureIds.permissions.franchiseCreate,
      scope: "network"
    },
    {
      roleId: fixtureIds.roles.hqAdmin,
      permissionId: fixtureIds.permissions.franchiseEdit,
      scope: "network"
    },
    {
      roleId: fixtureIds.roles.hqAdmin,
      permissionId: fixtureIds.permissions.agreementView,
      scope: "network"
    },
    {
      roleId: fixtureIds.roles.hqAdmin,
      permissionId: fixtureIds.permissions.agreementGenerate,
      scope: "network"
    },
    {
      roleId: fixtureIds.roles.hqAdmin,
      permissionId: fixtureIds.permissions.agreementSubmitApproval,
      scope: "network"
    },
    {
      roleId: fixtureIds.roles.hqAdmin,
      permissionId: fixtureIds.permissions.agreementApprove,
      scope: "network"
    },
    {
      roleId: fixtureIds.roles.hqAdmin,
      permissionId: fixtureIds.permissions.agreementVoid,
      scope: "network"
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
      scope: "network" as const
    })),
    {
      roleId: fixtureIds.roles.franchisee,
      permissionId: fixtureIds.permissions.agreementViewSignatureStatus,
      scope: "own_territory"
    },
    {
      roleId: fixtureIds.roles.franchisee,
      permissionId: fixtureIds.permissions.agreementDownloadExecuted,
      scope: "own_territory"
    },
    {
      roleId: fixtureIds.roles.franchisee,
      permissionId: fixtureIds.permissions.franchiseView,
      scope: "own_territory"
    },
    {
      roleId: fixtureIds.roles.franchisee,
      permissionId: fixtureIds.permissions.agreementView,
      scope: "own_territory"
    },
    ...[
      fixtureIds.permissions.documentView,
      fixtureIds.permissions.documentUpload,
      fixtureIds.permissions.documentDownload,
      fixtureIds.permissions.documentArchive
    ].map((permissionId) => ({
      roleId: fixtureIds.roles.hqAdmin,
      permissionId,
      scope: "network" as const
    })),
    {
      roleId: fixtureIds.roles.franchisee,
      permissionId: fixtureIds.permissions.documentView,
      scope: "own_territory"
    },
    {
      roleId: fixtureIds.roles.franchisee,
      permissionId: fixtureIds.permissions.documentDownload,
      scope: "own_territory"
    }
  ].map((grant) => {
    const permission = foundationSeed.permissions.find(
      (candidate) => candidate.id === grant.permissionId
    );

    if (!permission) {
      throw new Error("Franchise permission fixture is inconsistent.");
    }

    return {
      roleId: grant.roleId,
      permission,
      scope: grant.scope,
      constraints: {}
    };
  }),
  territories: foundationSeed.territories.map((territory) => ({
    id: territory.id,
    franchiseOrganisationId: territory.franchiseOrganisationId
  }))
};

export async function listFranchiseSummaries(context: FranchiseActorContext) {
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

export async function readFranchise360(
  context: FranchiseActorContext,
  franchiseId: string
): Promise<Franchise360> {
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

export function canEditFranchise(context: FranchiseActorContext) {
  return evaluatePermission(
    {
      userId: context.userId,
      module: "franchise",
      action: "edit",
      context
    },
    franchisePermissionData
  ).allowed;
}

export async function createFranchiseFromInput(
  context: FranchiseActorContext,
  input: FranchiseRecord
) {
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
        developmentESignProvider,
        {
          requestId,
          agreementId: current.id,
          signers: defaultSigners(requestId, view)
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
  return mutateCurrentSignatureRequest(context, franchiseId, (data, requestId, tx) =>
    resendSignatureRequest(
      context,
      franchisePermissionData,
      auditFor(tx),
      data,
      developmentESignProvider,
      requestId
    )
  );
}

export async function cancelCurrentSignatureRequest(
  context: FranchiseActorContext,
  franchiseId: string
) {
  return mutateCurrentSignatureRequest(context, franchiseId, (data, requestId, tx) =>
    cancelSignatureRequest(
      context,
      franchisePermissionData,
      auditFor(tx),
      data,
      developmentESignProvider,
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
        input.documentId,
        input.title
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
      const artifact = documentArtifact(artifactId, franchiseId, documentId, "Document version");
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

async function recordCurrentSignatureEvent(
  context: FranchiseActorContext,
  franchiseId: string,
  eventId: string,
  eventType: "signer.completed" | "declined" | "expired" | "cancelled" | "completed"
) {
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
          eventType === "completed" ? signedArtifact(franchiseId, eventId) : undefined,
        completionCertificateArtifact:
          eventType === "completed" ? certificateArtifact(franchiseId, eventId) : undefined,
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

function defaultSigners(
  requestId: string,
  view: Franchise360
): Array<Omit<AgreementSigner, "signatureRequestId" | "status">> {
  return [
    {
      id: `${requestId}-franchisee`,
      role: "franchisee",
      userId: view.owner?.id,
      name: view.owner?.displayName ?? "Franchisee",
      email: view.owner?.email ?? "franchisee@example.raring2go.test",
      signingOrder: 1,
      required: true
    },
    {
      id: `${requestId}-franchisor`,
      role: "franchisor",
      userId: fixtureIds.users.superAdmin,
      name: "Raring2go Head Office",
      email: "superadmin@example.raring2go.test",
      signingOrder: 2,
      required: true
    }
  ];
}

function signedArtifact(franchiseId: string, eventId: string) {
  return {
    id: `${eventId}-signed`,
    franchiseId,
    entityType: "franchise_agreement",
    entityId: fixtureIds.franchiseAgreements.suttonDraft,
    category: "signed_agreement" as const,
    label: "Signed franchise agreement",
    storageKey: `development/franchise-agreements/${eventId}/signed.pdf`,
    contentType: "application/pdf",
    providerMetadata: {
      provider: "development"
    }
  };
}

function certificateArtifact(franchiseId: string, eventId: string) {
  return {
    id: `${eventId}-certificate`,
    franchiseId,
    entityType: "franchise_agreement",
    entityId: fixtureIds.franchiseAgreements.suttonDraft,
    category: "completion_certificate" as const,
    label: "Completion certificate",
    storageKey: `development/franchise-agreements/${eventId}/certificate.pdf`,
    contentType: "application/pdf",
    providerMetadata: {
      provider: "development"
    }
  };
}

function documentArtifact(
  artifactId: string,
  franchiseId: string,
  documentId: string,
  title: string
): FranchiseArtifactReference {
  return {
    id: artifactId,
    franchiseId,
    entityType: "franchise_document",
    entityId: documentId,
    category: "vault_document",
    label: title,
    storageKey: `development/franchise-documents/${documentId}/${artifactId}.pdf`,
    contentType: "application/pdf",
    providerMetadata: {
      provider: "development"
    }
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
