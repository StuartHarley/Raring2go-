export type MarketingActorContext = {
  userId: string;
  organisationId?: string | null;
  territoryId?: string | null;
};

export type AudienceContact = {
  id: string;
  email: string;
  emailNormalised: string;
  firstName?: string | null;
  lastName?: string | null;
  emailStatus: string;
  tags: string[];
  metadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type AudienceTerritorySubscription = {
  id: string;
  contactId: string;
  territoryId: string;
  status: "subscribed" | "unsubscribed" | (string & {});
  source: string;
  preferences: Record<string, unknown>;
  subscribedAt?: string | null;
  unsubscribedAt?: string | null;
  deletedAt?: Date | null;
};

export type AudienceConsentEvent = {
  id: string;
  contactId: string;
  territoryId?: string | null;
  consentType: string;
  action: "granted" | "withdrawn" | (string & {});
  source: string;
  occurredAt: string;
  actorUserId?: string | null;
  evidence: Record<string, unknown>;
};

export type AudienceSuppression = {
  id: string;
  contactId: string;
  emailNormalised: string;
  territoryId?: string | null;
  reason: string;
  source: string;
  active: boolean;
  suppressedAt: string;
  metadata: Record<string, unknown>;
};

export type AudienceSegment = {
  id: string;
  territoryId?: string | null;
  key: string;
  name: string;
  segmentType: "dynamic" | "static" | (string & {});
  definition: Record<string, unknown>;
  status: string;
  deletedAt?: Date | null;
};

export type AudienceSegmentMember = {
  id: string;
  segmentId: string;
  contactId: string;
  addedAt: string;
  deletedAt?: Date | null;
};

export type AudienceImport = {
  id: string;
  territoryId?: string | null;
  source: string;
  status: string;
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  errorRows: number;
  metadata: Record<string, unknown>;
};

export type AudienceActivityEvent = {
  id: string;
  contactId: string;
  territoryId?: string | null;
  activityType: string;
  title: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
  deletedAt?: Date | null;
};

export type MarketingTerritory = {
  id: string;
  franchiseOrganisationId?: string | null;
  code?: string;
  name?: string;
};

export type MarketingData = {
  contacts: AudienceContact[];
  subscriptions: AudienceTerritorySubscription[];
  consentEvents: AudienceConsentEvent[];
  suppressions: AudienceSuppression[];
  segments: AudienceSegment[];
  segmentMembers: AudienceSegmentMember[];
  imports: AudienceImport[];
  activityEvents: AudienceActivityEvent[];
  territories: MarketingTerritory[];
};

export type AudienceContactView = {
  contact: AudienceContact;
  subscriptions: AudienceTerritorySubscription[];
  consentEvents: AudienceConsentEvent[];
  suppressions: AudienceSuppression[];
  activity: AudienceActivityEvent[];
};

export type AudienceOverview = {
  contacts: AudienceContactView[];
  totals: {
    contacts: number;
    subscribed: number;
    suppressed: number;
    territories: number;
  };
};
