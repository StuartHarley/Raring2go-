import {
  agreementTemplates,
  agreementVersions,
  auditEvents,
  agreementSignatureEvents,
  agreementSignatureRequests,
  agreementSigners,
  franchiseArtifactReferences,
  franchiseDomainEvents,
  franchiseAgreements,
  franchiseContacts,
  franchises,
  organisations,
  territories,
  users
} from "@raring2go/db";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import type { FranchiseData, FranchiseRecord } from "./types";

type FranchiseDb = any;

export async function loadFranchiseData(db: FranchiseDb): Promise<FranchiseData> {
  const [
    franchiseRows,
    contactRows,
    organisationRows,
    territoryRows,
    userRows,
    templateRows,
    versionRows,
    agreementRows,
    signatureRequestRows,
    signerRows,
    signatureEventRows,
    artifactRows,
    domainEventRows,
    activityRows
  ] = await Promise.all([
    db.select().from(franchises),
    db.select().from(franchiseContacts),
    db.select().from(organisations),
    db.select().from(territories),
    db.select().from(users),
    db.select().from(agreementTemplates),
    db.select().from(agreementVersions),
    db.select().from(franchiseAgreements),
    db.select().from(agreementSignatureRequests),
    db.select().from(agreementSigners),
    db.select().from(agreementSignatureEvents),
    db.select().from(franchiseArtifactReferences),
    db.select().from(franchiseDomainEvents),
    db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(50)
  ]);

  return {
    franchises: franchiseRows.map(toFranchiseRecord),
    contacts: contactRows,
    organisations: organisationRows,
    territories: territoryRows,
    users: userRows,
    agreementTemplates: templateRows,
    agreementVersions: versionRows.map((version: any) => ({
      ...version,
      approvedAt: dateToString(version.approvedAt)
    })),
    franchiseAgreements: agreementRows.map((agreement: any) => ({
      ...agreement,
      submittedAt: dateToString(agreement.submittedAt),
      approvedAt: dateToString(agreement.approvedAt),
      voidedAt: dateToString(agreement.voidedAt),
      executedAt: dateToString(agreement.executedAt)
    })),
    signatureRequests: signatureRequestRows.map((request: any) => ({
      ...request,
      sentAt: dateToString(request.sentAt),
      cancelledAt: dateToString(request.cancelledAt),
      expiredAt: dateToString(request.expiredAt),
      declinedAt: dateToString(request.declinedAt),
      completedAt: dateToString(request.completedAt)
    })),
    signers: signerRows.map((signer: any) => ({
      ...signer,
      completedAt: dateToString(signer.completedAt)
    })),
    signatureEvents: signatureEventRows.map((event: any) => ({
      ...event,
      processedAt: dateToString(event.processedAt)
    })),
    artifactReferences: artifactRows.map((artifact: any) => ({
      ...artifact,
      lockedAt: dateToString(artifact.lockedAt)
    })),
    domainEvents: domainEventRows.map((event: any) => ({
      ...event,
      processedAt: dateToString(event.processedAt)
    })),
    activity: activityRows.map((event: any) => ({
      id: event.id,
      action: event.action,
      actorUserId: event.actorUserId,
      entityType: event.entityType,
      entityId: event.entityId,
      createdAt: event.createdAt
    }))
  };
}

export async function insertFranchiseAgreement(
  db: FranchiseDb,
  agreement: NonNullable<FranchiseData["franchiseAgreements"]>[number]
) {
  await db.insert(franchiseAgreements).values({
    ...agreement,
    submittedAt: agreement.submittedAt ? new Date(agreement.submittedAt) : null,
    approvedAt: agreement.approvedAt ? new Date(agreement.approvedAt) : null,
    voidedAt: agreement.voidedAt ? new Date(agreement.voidedAt) : null
  });
}

export async function insertFranchiseRecord(db: FranchiseDb, franchise: FranchiseRecord) {
  await db.insert(franchises).values({
    ...franchise,
    launchDate: franchise.launchDate ? new Date(franchise.launchDate) : null,
    renewalDate: franchise.renewalDate ? new Date(franchise.renewalDate) : null,
    endDate: franchise.endDate ? new Date(franchise.endDate) : null
  });
}

export async function updateFranchiseAgreementState(
  db: FranchiseDb,
  agreement: NonNullable<FranchiseData["franchiseAgreements"]>[number]
) {
  await db
    .update(franchiseAgreements)
    .set({
      status: agreement.status,
      submittedAt: agreement.submittedAt ? new Date(agreement.submittedAt) : null,
      approvedByUserId: agreement.approvedByUserId,
      approvedAt: agreement.approvedAt ? new Date(agreement.approvedAt) : null,
      voidedAt: agreement.voidedAt ? new Date(agreement.voidedAt) : null,
      executedAt: agreement.executedAt ? new Date(agreement.executedAt) : null,
      signedAgreementArtifactId: agreement.signedAgreementArtifactId,
      completionCertificateArtifactId: agreement.completionCertificateArtifactId
    })
    .where(eq(franchiseAgreements.id, agreement.id));
}

export async function insertSignatureRequest(
  db: FranchiseDb,
  request: NonNullable<FranchiseData["signatureRequests"]>[number]
) {
  await db.insert(agreementSignatureRequests).values({
    ...request,
    sentAt: request.sentAt ? new Date(request.sentAt) : null,
    cancelledAt: request.cancelledAt ? new Date(request.cancelledAt) : null,
    expiredAt: request.expiredAt ? new Date(request.expiredAt) : null,
    declinedAt: request.declinedAt ? new Date(request.declinedAt) : null,
    completedAt: request.completedAt ? new Date(request.completedAt) : null
  });
}

export async function insertSigners(
  db: FranchiseDb,
  signers: NonNullable<FranchiseData["signers"]>
) {
  if (signers.length === 0) {
    return;
  }

  await db.insert(agreementSigners).values(signers.map((signer) => ({
    ...signer,
    completedAt: signer.completedAt ? new Date(signer.completedAt) : null
  })));
}

export async function syncSignatureRequestGraph(
  db: FranchiseDb,
  data: FranchiseData,
  requestId: string
) {
  const request = data.signatureRequests?.find((candidate) => candidate.id === requestId);

  if (request) {
    await db.update(agreementSignatureRequests).set({
      status: request.status,
      providerMetadata: request.providerMetadata ?? {},
      cancelledAt: request.cancelledAt ? new Date(request.cancelledAt) : null,
      expiredAt: request.expiredAt ? new Date(request.expiredAt) : null,
      declinedAt: request.declinedAt ? new Date(request.declinedAt) : null,
      completedAt: request.completedAt ? new Date(request.completedAt) : null
    }).where(eq(agreementSignatureRequests.id, request.id));
  }

  for (const signer of data.signers?.filter((candidate) => candidate.signatureRequestId === requestId) ?? []) {
    await db.update(agreementSigners).set({
      status: signer.status,
      completedAt: signer.completedAt ? new Date(signer.completedAt) : null
    }).where(eq(agreementSigners.id, signer.id));
  }

  for (const event of data.signatureEvents ?? []) {
    await db.insert(agreementSignatureEvents).values({
      ...event,
      processedAt: event.processedAt ? new Date(event.processedAt) : null
    }).onConflictDoNothing();
  }

  for (const artifact of data.artifactReferences ?? []) {
    await db.insert(franchiseArtifactReferences).values({
      ...artifact,
      lockedAt: artifact.lockedAt ? new Date(artifact.lockedAt) : null
    }).onConflictDoNothing();
  }

  for (const event of data.domainEvents ?? []) {
    await db.insert(franchiseDomainEvents).values({
      ...event,
      processedAt: event.processedAt ? new Date(event.processedAt) : null
    }).onConflictDoNothing();
  }
}

export async function updateFranchiseRecord(
  db: FranchiseDb,
  franchiseId: string,
  patch: Partial<FranchiseRecord>
) {
  await db
    .update(franchises)
    .set({
      ...patch,
      launchDate: patch.launchDate ? new Date(patch.launchDate) : undefined,
      renewalDate: patch.renewalDate ? new Date(patch.renewalDate) : undefined,
      endDate: patch.endDate ? new Date(patch.endDate) : undefined
    })
    .where(eq(franchises.id, franchiseId));
}

export async function latestApprovedAgreementVersionId(db: FranchiseDb) {
  const [version] = await db
    .select()
    .from(agreementVersions)
    .where(and(eq(agreementVersions.status, "approved"), isNull(agreementVersions.deletedAt)))
    .orderBy(desc(agreementVersions.version))
    .limit(1);

  if (!version) {
    throw new Error("No approved agreement template version is available.");
  }

  return version.id;
}

export async function activeAgreementForFranchise(db: FranchiseDb, franchiseId: string) {
  const [agreement] = await db
    .select()
    .from(franchiseAgreements)
    .where(
      and(
        eq(franchiseAgreements.franchiseId, franchiseId),
        isNull(franchiseAgreements.deletedAt),
        ne(franchiseAgreements.status, "void"),
        ne(franchiseAgreements.status, "superseded")
      )
    )
    .limit(1);

  return agreement;
}

function toFranchiseRecord(franchise: typeof franchises.$inferSelect): FranchiseRecord {
  return {
    ...franchise,
    launchDate: dateToString(franchise.launchDate),
    renewalDate: dateToString(franchise.renewalDate),
    endDate: dateToString(franchise.endDate),
    status: franchise.status as FranchiseRecord["status"],
    lifecycleStage: franchise.lifecycleStage as FranchiseRecord["lifecycleStage"]
  };
}

function dateToString(date: Date | string | null | undefined) {
  if (!date) {
    return null;
  }

  return date instanceof Date ? date.toISOString().slice(0, 10) : date;
}
