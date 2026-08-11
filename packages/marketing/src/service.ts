import { auditActions } from "@raring2go/audit";
import { requirePermission, type PermissionData } from "@raring2go/permissions";
import { marketingCapabilities, type MarketingCapability } from "./permissions";
import type {
  AudienceConsentEvent,
  AudienceContact,
  AudienceContactView,
  AudienceOverview,
  AudienceSegment,
  AudienceSuppression,
  AudienceTerritorySubscription,
  MarketingActorContext,
  MarketingData
} from "./types";

type MarketingAuditRecorder = {
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

export function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

export function listAudienceContacts(
  context: MarketingActorContext,
  permissions: PermissionData,
  data: MarketingData
): AudienceOverview {
  requireMarketingPermission(context, permissions, "audienceView");
  const visibleTerritoryIds = visibleTerritories(context, data);
  const contacts = data.contacts
    .filter((contact) => !contact.deletedAt)
    .filter((contact) => contactVisibleInTerritories(contact.id, visibleTerritoryIds, data))
    .map((contact) => assembleContactView(data, contact, visibleTerritoryIds))
    .sort((left, right) => left.contact.emailNormalised.localeCompare(right.contact.emailNormalised));

  return {
    contacts,
    totals: {
      contacts: contacts.length,
      subscribed: contacts.filter((view) => view.subscriptions.some((subscription) => subscription.status === "subscribed")).length,
      suppressed: contacts.filter((view) => view.suppressions.some((suppression) => suppression.active)).length,
      territories: new Set(contacts.flatMap((view) => view.subscriptions.map((subscription) => subscription.territoryId))).size
    }
  };
}

export async function upsertAudienceContact(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  contact: AudienceContact
) {
  requireMarketingPermission(context, permissions, "audienceManage");
  const emailNormalised = normaliseEmail(contact.email);
  const existing = data.contacts.find((candidate) => candidate.emailNormalised === emailNormalised && !candidate.deletedAt);
  if (existing) {
    Object.assign(existing, {
      firstName: contact.firstName ?? existing.firstName,
      lastName: contact.lastName ?? existing.lastName,
      tags: [...new Set([...existing.tags, ...contact.tags])],
      metadata: { ...existing.metadata, ...contact.metadata }
    });
    await audit.record(auditEvent(context, auditActions.marketingAudienceContactUpdate, existing, {
      deduped: true
    }));
    return existing;
  }
  const created = {
    ...contact,
    emailNormalised
  };
  data.contacts.push(created);
  await audit.record(auditEvent(context, auditActions.marketingAudienceContactCreate, created, {
    source: created.metadata.source ?? "unknown"
  }));
  return created;
}

export async function subscribeContactToTerritory(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  subscription: AudienceTerritorySubscription
) {
  requireMarketingPermission(context, permissions, "audienceManage");
  ensureContextCanAccessTerritory(context, subscription.territoryId);
  requireContact(data, subscription.contactId);
  const existing = data.subscriptions.find((candidate) => candidate.contactId === subscription.contactId && candidate.territoryId === subscription.territoryId && !candidate.deletedAt);
  if (existing) {
    Object.assign(existing, {
      status: subscription.status,
      preferences: subscription.preferences,
      unsubscribedAt: subscription.unsubscribedAt
    });
    return existing;
  }
  data.subscriptions.push(subscription);
  await audit.record(auditEvent(context, auditActions.marketingAudienceSubscribe, requireContact(data, subscription.contactId), {
    territoryId: subscription.territoryId,
    status: subscription.status
  }, subscription.territoryId));
  return subscription;
}

export async function recordConsentEvent(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  consent: AudienceConsentEvent
) {
  requireMarketingPermission(context, permissions, "consentManage");
  if (consent.territoryId) {
    ensureContextCanAccessTerritory(context, consent.territoryId);
  }
  const contact = requireContact(data, consent.contactId);
  data.consentEvents.push(consent);
  await audit.record(auditEvent(context, auditActions.marketingConsentRecord, contact, {
    consentType: consent.consentType,
    action: consent.action,
    source: consent.source
  }, consent.territoryId));
  return consent;
}

export async function suppressContact(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  suppression: AudienceSuppression
) {
  requireMarketingPermission(context, permissions, "consentManage");
  if (suppression.territoryId) {
    ensureContextCanAccessTerritory(context, suppression.territoryId);
  }
  const contact = requireContact(data, suppression.contactId);
  data.suppressions.push(suppression);
  contact.emailStatus = "suppressed";
  await audit.record(auditEvent(context, auditActions.marketingAudienceSuppress, contact, {
    reason: suppression.reason,
    territoryId: suppression.territoryId ?? null
  }, suppression.territoryId));
  return suppression;
}

export function previewSegment(
  context: MarketingActorContext,
  permissions: PermissionData,
  data: MarketingData,
  segmentId: string
): AudienceContactView[] {
  requireMarketingPermission(context, permissions, "segmentView");
  const segment = requireSegment(data, segmentId);
  if (segment.territoryId) {
    ensureContextCanAccessTerritory(context, segment.territoryId);
  }
  const visibleTerritoryIds = visibleTerritories(context, data);
  const audience = listAudienceContacts(context, permissions, data).contacts;
  return audience.filter((view) => contactMatchesSegment(view, segment, visibleTerritoryIds));
}

function contactMatchesSegment(
  view: AudienceContactView,
  segment: AudienceSegment,
  visibleTerritoryIds: Set<string> | null
) {
  if (view.suppressions.some((suppression) => suppression.active)) {
    return false;
  }
  if (segment.segmentType === "static") {
    return view.contact.metadata.segmentIds instanceof Array && view.contact.metadata.segmentIds.includes(segment.id);
  }
  const territoryId = typeof segment.definition.territoryId === "string" ? segment.definition.territoryId : segment.territoryId;
  if (territoryId && (visibleTerritoryIds == null || visibleTerritoryIds.has(territoryId))) {
    return view.subscriptions.some((subscription) => subscription.territoryId === territoryId && subscription.status === "subscribed");
  }
  return view.subscriptions.some((subscription) => subscription.status === "subscribed");
}

function assembleContactView(data: MarketingData, contact: AudienceContact, visibleTerritoryIds: Set<string> | null): AudienceContactView {
  const territoryFilter = (territoryId?: string | null) => visibleTerritoryIds == null || !territoryId || visibleTerritoryIds.has(territoryId);
  return {
    contact,
    subscriptions: data.subscriptions.filter((subscription) => subscription.contactId === contact.id && !subscription.deletedAt && territoryFilter(subscription.territoryId)),
    consentEvents: data.consentEvents.filter((event) => event.contactId === contact.id && territoryFilter(event.territoryId)),
    suppressions: data.suppressions.filter((suppression) => suppression.contactId === contact.id && suppression.active && territoryFilter(suppression.territoryId)),
    activity: data.activityEvents.filter((event) => event.contactId === contact.id && !event.deletedAt && territoryFilter(event.territoryId))
  };
}

function contactVisibleInTerritories(contactId: string, visibleTerritoryIds: Set<string> | null, data: MarketingData) {
  if (visibleTerritoryIds == null) {
    return true;
  }
  return data.subscriptions.some((subscription) => subscription.contactId === contactId && visibleTerritoryIds.has(subscription.territoryId) && !subscription.deletedAt);
}

function visibleTerritories(context: MarketingActorContext, data: MarketingData) {
  if (!context.territoryId) {
    return null;
  }
  return new Set(data.territories.filter((territory) => territory.id === context.territoryId).map((territory) => territory.id));
}

function requireMarketingPermission(
  context: MarketingActorContext,
  permissions: PermissionData,
  capability: MarketingCapability
) {
  const required = marketingCapabilities[capability];
  return requirePermission({
    userId: context.userId,
    module: required.module,
    action: required.action,
    context: {
      organisationId: context.organisationId ?? undefined,
      territoryId: context.territoryId ?? undefined
    }
  }, permissions);
}

function ensureContextCanAccessTerritory(context: MarketingActorContext, territoryId: string) {
  if (context.territoryId && context.territoryId !== territoryId) {
    throw new Error("Audience record is outside the active territory.");
  }
}

function requireContact(data: MarketingData, contactId: string) {
  const contact = data.contacts.find((candidate) => candidate.id === contactId && !candidate.deletedAt);
  if (!contact) {
    throw new Error("Audience contact was not found.");
  }
  return contact;
}

function requireSegment(data: MarketingData, segmentId: string) {
  const segment = data.segments.find((candidate) => candidate.id === segmentId && !candidate.deletedAt);
  if (!segment) {
    throw new Error("Audience segment was not found.");
  }
  return segment;
}

function auditEvent(
  context: MarketingActorContext,
  action: string,
  contact: AudienceContact,
  payload: Record<string, unknown>,
  territoryId?: string | null
) {
  return {
    action,
    actorUserId: context.userId,
    entityType: "audience_contact",
    entityId: contact.id,
    organisationId: context.organisationId,
    territoryId: territoryId ?? context.territoryId,
    payload
  };
}
