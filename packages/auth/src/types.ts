import type { RecordAuditEventInput } from "@raring2go/audit";

export type AuthenticationAssuranceLevel = "standard" | "mfa";

export type AuthUser = {
  id: string;
  email: string;
  displayName?: string | null;
  status: "active" | "invited" | "disabled" | string;
};

export type AuthOrganisation = {
  id: string;
  kind: "hq" | "franchise" | "advertiser" | string;
  name: string;
};

export type AuthMembership = {
  id: string;
  userId: string;
  organisationId: string;
  status: "active" | "pending" | "disabled" | string;
};

export type AuthTerritory = {
  id: string;
  franchiseOrganisationId?: string | null;
  code: string;
  name: string;
  status: "active" | string;
};

export type AuthInvitation = {
  id: string;
  email: string;
  organisationId: string;
  territoryId?: string | null;
  /** Role granted on acceptance, scoped to the organisation and territory above. */
  roleId?: string | null;
  tokenHash: string;
  status: "pending" | "accepted" | "revoked" | string;
  acceptedByUserId?: string | null;
  expiresAt: Date;
  acceptedAt?: Date | null;
  revokedAt?: Date | null;
};

export type AuthSession = {
  id: string;
  userId: string;
  sessionTokenHash: string;
  assuranceLevel: AuthenticationAssuranceLevel;
  expiresAt: Date;
  revokedAt?: Date | null;
};

export type AuthVerificationToken = {
  id: string;
  identifier: string;
  tokenHash: string;
  purpose: "sign_in" | "account_recovery" | string;
  expiresAt: Date;
  usedAt?: Date | null;
};

export type WorkingContext = {
  userId: string;
  organisationId: string;
  territoryId?: string;
  assuranceLevel: AuthenticationAssuranceLevel;
};

export type AuthRepository = {
  findUserByEmail(email: string): Promise<AuthUser | null>;
  findUserById(userId: string): Promise<AuthUser | null>;
  createUser(input: { email: string; displayName?: string }): Promise<AuthUser>;
  findMembershipsForUser(userId: string): Promise<AuthMembership[]>;
  findTerritoryById(territoryId: string): Promise<AuthTerritory | null>;
  findInvitationByTokenHash(tokenHash: string): Promise<AuthInvitation | null>;
  /** Claims the invitation. Returns false if it was no longer pending, so a double accept cannot succeed twice. */
  markInvitationAccepted(input: {
    invitationId: string;
    userId: string;
    acceptedAt: Date;
  }): Promise<boolean>;
  /** Idempotently gives the user a role in an organisation (and territory). */
  grantRole(input: {
    userId: string;
    roleId: string;
    organisationId: string;
    territoryId?: string | null;
  }): Promise<void>;
  ensureMembership(input: {
    userId: string;
    organisationId: string;
    status: "active";
  }): Promise<AuthMembership>;
  createSession(input: {
    userId: string;
    sessionTokenHash: string;
    assuranceLevel: AuthenticationAssuranceLevel;
    expiresAt: Date;
  }): Promise<AuthSession>;
  findSessionByTokenHash(tokenHash: string): Promise<AuthSession | null>;
  revokeSession(input: { sessionId: string; revokedAt: Date }): Promise<void>;
  /** Revokes every still-active session the user has; returns how many were ended. */
  revokeAllSessionsForUser(input: { userId: string; revokedAt: Date }): Promise<number>;
};

export type AuthTokenRepository = {
  createVerificationToken(input: {
    identifier: string;
    tokenHash: string;
    purpose: AuthVerificationToken["purpose"];
    expiresAt: Date;
  }): Promise<AuthVerificationToken>;
  findVerificationTokenByHash(tokenHash: string): Promise<AuthVerificationToken | null>;
  /** Consumes the token. Returns false if it was already used, so a replayed link cannot sign in twice. */
  markVerificationTokenUsed(input: {
    tokenId: string;
    usedAt: Date;
  }): Promise<boolean>;
};

export type AuditRecorder = {
  record(input: RecordAuditEventInput): Promise<void>;
};
