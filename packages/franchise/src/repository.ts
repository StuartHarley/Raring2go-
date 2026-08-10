import {
  agreementTemplates,
  agreementVersions,
  auditEvents,
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
      voidedAt: dateToString(agreement.voidedAt)
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
      voidedAt: agreement.voidedAt ? new Date(agreement.voidedAt) : null
    })
    .where(eq(franchiseAgreements.id, agreement.id));
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
