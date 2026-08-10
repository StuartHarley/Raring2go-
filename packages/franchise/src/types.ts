export type FranchiseStatus = "active" | "suspended" | "ended" | "archived";
export type FranchiseLifecycleStage = "onboarding" | "trading" | "renewal" | "exit";
export type AgreementTemplateStatus = "active" | "archived";
export type AgreementVersionStatus = "draft" | "approved" | "archived";
export type FranchiseAgreementStatus =
  | "draft"
  | "pending_internal_approval"
  | "approved"
  | "void"
  | "superseded";
export type AgreementMergeVariables = Record<string, string | number | boolean | null>;

export type FranchiseRecord = {
  id: string;
  franchiseOrganisationId: string;
  primaryTerritoryId: string;
  primaryOwnerUserId?: string | null;
  status: FranchiseStatus;
  lifecycleStage: FranchiseLifecycleStage;
  launchDate?: string | null;
  renewalDate?: string | null;
  endDate?: string | null;
  onboardingStatus: string;
  supportStatus: string;
  tags: string[];
  deletedAt?: Date | null;
};

export type FranchiseContact = {
  id: string;
  franchiseId: string;
  userId?: string | null;
  label: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary: boolean;
  deletedAt?: Date | null;
};

export type FranchiseOrganisation = {
  id: string;
  kind: string;
  name: string;
};

export type FranchiseTerritory = {
  id: string;
  franchiseOrganisationId?: string | null;
  code: string;
  name: string;
  status: string;
};

export type FranchiseUser = {
  id: string;
  email: string;
  displayName?: string | null;
};

export type FranchiseAuditEvent = {
  id: string;
  action: string;
  actorUserId?: string | null;
  entityType: string;
  entityId?: string | null;
  createdAt: Date;
};

export type AgreementTemplate = {
  id: string;
  key: string;
  name: string;
  status: AgreementTemplateStatus;
  deletedAt?: Date | null;
};

export type AgreementVersion = {
  id: string;
  templateId: string;
  version: string;
  status: AgreementVersionStatus;
  controlledMergeFields: string[];
  content: Record<string, unknown>;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  deletedAt?: Date | null;
};

export type FranchiseAgreement = {
  id: string;
  franchiseId: string;
  agreementVersionId: string;
  status: FranchiseAgreementStatus;
  mergeVariables: AgreementMergeVariables;
  generatedContent: Record<string, unknown>;
  submittedAt?: string | null;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  voidedAt?: string | null;
  supersededByAgreementId?: string | null;
  deletedAt?: Date | null;
};

export type FranchiseAgreementSummary = FranchiseAgreement & {
  template: AgreementTemplate;
  version: AgreementVersion;
};

export type Franchise360 = {
  franchise: FranchiseRecord;
  organisation: FranchiseOrganisation;
  territory: FranchiseTerritory;
  owner?: FranchiseUser;
  contacts: Array<FranchiseContact & { user?: FranchiseUser }>;
  activity: FranchiseAuditEvent[];
  agreement?: FranchiseAgreementSummary;
  placeholders: {
    performance: "deferred";
    compliance: "deferred";
    training: "deferred";
    support: "deferred";
    documents: "deferred";
  };
};

export type FranchiseData = {
  franchises: FranchiseRecord[];
  contacts: FranchiseContact[];
  organisations: FranchiseOrganisation[];
  territories: FranchiseTerritory[];
  users: FranchiseUser[];
  agreementTemplates?: AgreementTemplate[];
  agreementVersions?: AgreementVersion[];
  franchiseAgreements?: FranchiseAgreement[];
  activity?: FranchiseAuditEvent[];
};
