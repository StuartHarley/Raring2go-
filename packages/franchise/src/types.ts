export type FranchiseStatus = "active" | "suspended" | "ended" | "archived";
export type FranchiseLifecycleStage = "onboarding" | "trading" | "renewal" | "exit";

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

export type Franchise360 = {
  franchise: FranchiseRecord;
  organisation: FranchiseOrganisation;
  territory: FranchiseTerritory;
  owner?: FranchiseUser;
  contacts: Array<FranchiseContact & { user?: FranchiseUser }>;
  activity: FranchiseAuditEvent[];
  placeholders: {
    performance: "deferred";
    agreement: "deferred";
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
  activity?: FranchiseAuditEvent[];
};
