import { auditActions } from "@raring2go/audit";
import { requirePermission, type PermissionData } from "@raring2go/permissions";
import { advertisingCapabilities, type AdvertisingCapability } from "./permissions";
import type {
  Advertiser360,
  AdvertiserActivityEvent,
  AdvertiserContact,
  AdvertiserRecord,
  AdvertisingActorContext,
  AdvertisingData
} from "./types";

type AdvertisingAuditRecorder = {
  record(event: {
    action: string;
    actorUserId?: string | null;
    entityType: string;
    entityId?: string | null;
    organisationId?: string | null;
    territoryId?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<void>;
};

export function listAdvertisers(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  data: AdvertisingData
): Advertiser360[] {
  requireAdvertisingPermission(context, permissions, "view");
  const visibleTerritoryIds = visibleTerritories(context, data);

  return data.advertisers
    .filter((advertiser) => !advertiser.deletedAt && advertiser.status !== "archived")
    .filter((advertiser) => visibleTerritoryIds == null || visibleTerritoryIds.has(advertiser.owningTerritoryId))
    .map((advertiser) => assembleAdvertiser360(data, advertiser))
    .sort((left, right) => left.organisation.name.localeCompare(right.organisation.name));
}

export function getAdvertiser360(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  data: AdvertisingData,
  advertiserId: string
): Advertiser360 {
  requireAdvertisingPermission(context, permissions, "view");
  const advertiser = requireAdvertiser(data, advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  return assembleAdvertiser360(data, advertiser);
}

export async function createAdvertiser(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  advertiser: AdvertiserRecord
) {
  requireAdvertisingPermission(context, permissions, "create");
  ensureContextCanAccessAdvertiser(context, advertiser);
  if (data.advertisers.some((candidate) => candidate.advertiserOrganisationId === advertiser.advertiserOrganisationId && !candidate.deletedAt)) {
    throw new Error("Advertiser organisation already has an advertiser CRM record.");
  }
  const organisation = requireOrganisation(data, advertiser.advertiserOrganisationId);
  if (organisation.kind !== "advertiser") {
    throw new Error("Advertiser records must reference an advertiser organisation.");
  }
  data.advertisers.push(advertiser);
  await audit.record(auditEvent(context, auditActions.advertiserCreate, advertiser, {
    relationshipState: advertiser.relationshipState,
    annualAdvertiserValueMinor: advertiser.annualAdvertiserValueMinor
  }));
  return advertiser;
}

export async function updateAdvertiser(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  advertiserId: string,
  patch: Partial<Pick<AdvertiserRecord, "status" | "relationshipState" | "accountOwnerUserId" | "tags" | "commercialMetadata">>
) {
  requireAdvertisingPermission(context, permissions, "edit");
  const advertiser = requireAdvertiser(data, advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  Object.assign(advertiser, patch);
  await audit.record(auditEvent(context, auditActions.advertiserUpdate, advertiser, {
    patch: Object.keys(patch)
  }));
  return advertiser;
}

export async function addAdvertiserContact(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  contact: AdvertiserContact
) {
  requireAdvertisingPermission(context, permissions, "contactManage");
  const advertiser = requireAdvertiser(data, contact.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  if (contact.userId && (contact.name || contact.email)) {
    throw new Error("Linked user contacts should not duplicate user identity fields.");
  }
  data.contacts.push(contact);
  await audit.record(auditEvent(context, auditActions.advertiserContactUpdate, advertiser, {
    action: "add_contact",
    contactId: contact.id,
    linkedUser: Boolean(contact.userId)
  }));
  return contact;
}

export async function recordAdvertiserActivity(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  event: AdvertiserActivityEvent
) {
  requireAdvertisingPermission(context, permissions, "activityRecord");
  const advertiser = requireAdvertiser(data, event.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  if (event.territoryId !== advertiser.owningTerritoryId) {
    throw new Error("Advertiser activity must use the owning territory.");
  }
  data.activityEvents.push(event);
  await audit.record(auditEvent(context, auditActions.advertiserActivityRecord, advertiser, {
    activityType: event.activityType,
    title: event.title
  }));
  return event;
}

function assembleAdvertiser360(data: AdvertisingData, advertiser: AdvertiserRecord): Advertiser360 {
  return {
    advertiser,
    organisation: requireOrganisation(data, advertiser.advertiserOrganisationId),
    territory: data.territories.find((territory) => territory.id === advertiser.owningTerritoryId),
    contacts: data.contacts.filter((contact) => contact.advertiserId === advertiser.id && !contact.deletedAt),
    activity: data.activityEvents
      .filter((event) => event.advertiserId === advertiser.id && !event.deletedAt)
      .slice()
      .reverse(),
    latestMetrics: data.metricSnapshots
      .filter((snapshot) => snapshot.advertiserId === advertiser.id && !snapshot.deletedAt)
      .sort((left, right) => right.periodKey.localeCompare(left.periodKey))[0]
  };
}

function requireAdvertisingPermission(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  capability: AdvertisingCapability
) {
  const permission = advertisingCapabilities[capability];
  requirePermission({
    userId: context.userId,
    module: permission.module,
    action: permission.action,
    context: {
      organisationId: context.organisationId ?? undefined,
      territoryId: context.territoryId ?? undefined
    }
  }, permissions);
}

function visibleTerritories(context: AdvertisingActorContext, data: AdvertisingData) {
  if (!context.territoryId) {
    return null;
  }
  const territory = data.territories.find((candidate) => candidate.id === context.territoryId);
  if (!territory) {
    throw new Error("Active territory context is invalid.");
  }
  return new Set([territory.id]);
}

function ensureContextCanAccessAdvertiser(context: AdvertisingActorContext, advertiser: AdvertiserRecord) {
  if (context.territoryId && context.territoryId !== advertiser.owningTerritoryId) {
    throw new Error("Advertiser is outside the active territory.");
  }
}

function requireAdvertiser(data: AdvertisingData, advertiserId: string) {
  const advertiser = data.advertisers.find((candidate) => candidate.id === advertiserId && !candidate.deletedAt);
  if (!advertiser) {
    throw new Error("Advertiser was not found.");
  }
  return advertiser;
}

function requireOrganisation(data: AdvertisingData, organisationId: string) {
  const organisation = data.organisations.find((candidate) => candidate.id === organisationId);
  if (!organisation) {
    throw new Error("Advertiser organisation was not found.");
  }
  return organisation;
}

function auditEvent(
  context: AdvertisingActorContext,
  action: string,
  advertiser: AdvertiserRecord,
  payload: Record<string, unknown>
) {
  return {
    action,
    actorUserId: context.userId,
    entityType: "advertiser",
    entityId: advertiser.id,
    organisationId: context.organisationId,
    territoryId: advertiser.owningTerritoryId,
    payload
  };
}
