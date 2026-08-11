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
  emailTemplates: EmailTemplate[];
  emailCampaigns: EmailCampaign[];
  emailCampaignVersions: EmailCampaignVersion[];
  emailRecipientSnapshots: EmailRecipientSnapshot[];
  emailDeliveryRecords: EmailDeliveryRecord[];
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

export type EmailTemplate = {
  id: string;
  key: string;
  name: string;
  templateType: string;
  status: string;
  blocks: Array<Record<string, unknown>>;
  requiredBlocks: string[];
  metadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type EmailCampaign = {
  id: string;
  territoryId?: string | null;
  templateId?: string | null;
  segmentId?: string | null;
  campaignType: string;
  status: "draft" | "approved" | "scheduled" | "sending" | "sent" | "cancelled" | (string & {});
  title: string;
  subject: string;
  preheader?: string | null;
  scheduledAt?: string | null;
  approvedAt?: string | null;
  sentAt?: string | null;
  metadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type EmailCampaignVersion = {
  id: string;
  campaignId: string;
  versionNumber: number;
  status: string;
  subject: string;
  preheader?: string | null;
  contentSnapshot: Record<string, unknown>;
  createdByUserId?: string | null;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  deletedAt?: Date | null;
};

export type EmailRecipientSnapshot = {
  id: string;
  campaignId: string;
  campaignVersionId: string;
  segmentId?: string | null;
  status: string;
  generatedAt: string;
  recipientCount: number;
  excludedCount: number;
  recipients: Array<Record<string, unknown>>;
  exclusions: Array<Record<string, unknown>>;
  idempotencyKey: string;
};

export type EmailDeliveryRecord = {
  id: string;
  campaignId: string;
  campaignVersionId: string;
  recipientSnapshotId?: string | null;
  contactId?: string | null;
  emailNormalised: string;
  providerKey?: string | null;
  providerMessageId?: string | null;
  status: string;
  eventType?: string | null;
  eventAt?: string | null;
  metadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type EmailDeliveryProvider = {
  key: string;
  send(input: {
    campaign: EmailCampaign;
    version: EmailCampaignVersion;
    snapshot: EmailRecipientSnapshot;
  }): Promise<{ providerBatchId?: string | null }>;
};

export type EmailCampaignOverview = {
  campaigns: Array<{
    campaign: EmailCampaign;
    latestVersion?: EmailCampaignVersion;
    latestSnapshot?: EmailRecipientSnapshot;
    deliveryCount: number;
  }>;
  totals: {
    campaigns: number;
    draft: number;
    scheduled: number;
    sent: number;
  };
};
