import type {
  AuditRecorder,
  AuthInvitation,
  AuthMembership,
  AuthRepository,
  AuthSession,
  AuthTerritory,
  AuthTokenRepository,
  AuthVerificationToken,
  AuthUser
} from "./types";

export function createMemoryAuthRepository(input?: {
  users?: AuthUser[];
  memberships?: AuthMembership[];
  territories?: AuthTerritory[];
  invitations?: AuthInvitation[];
  sessions?: AuthSession[];
  verificationTokens?: AuthVerificationToken[];
}): AuthRepository & {
  users: AuthUser[];
  memberships: AuthMembership[];
  sessions: AuthSession[];
  verificationTokens: AuthVerificationToken[];
  roleGrants: Array<{ userId: string; roleId: string; organisationId: string; territoryId?: string | null }>;
} & AuthTokenRepository {
  const users = [...(input?.users ?? [])];
  const memberships = [...(input?.memberships ?? [])];
  const territories = [...(input?.territories ?? [])];
  const invitations = [...(input?.invitations ?? [])];
  const sessions = [...(input?.sessions ?? [])];
  const verificationTokens = [...(input?.verificationTokens ?? [])];
  const roleGrants: Array<{ userId: string; roleId: string; organisationId: string; territoryId?: string | null }> = [];

  return {
    users,
    memberships,
    sessions,
    verificationTokens,
    roleGrants,
    async findUserByEmail(email) {
      return users.find((user) => user.email === email) ?? null;
    },
    async findUserById(userId) {
      return users.find((user) => user.id === userId) ?? null;
    },
    async createUser(userInput) {
      const user: AuthUser = {
        id: `user_${users.length + 1}`,
        email: userInput.email,
        displayName: userInput.displayName,
        status: "active"
      };
      users.push(user);
      return user;
    },
    async findMembershipsForUser(userId) {
      return memberships.filter((membership) => membership.userId === userId);
    },
    async findTerritoryById(territoryId) {
      return territories.find((territory) => territory.id === territoryId) ?? null;
    },
    async findInvitationByTokenHash(tokenHash) {
      return invitations.find((invitation) => invitation.tokenHash === tokenHash) ?? null;
    },
    async markInvitationAccepted(markInput) {
      const invitation = invitations.find(
        (candidate) => candidate.id === markInput.invitationId
      );

      if (!invitation) {
        throw new Error("Invitation was not found.");
      }

      if (invitation.status !== "pending") {
        return false;
      }

      invitation.status = "accepted";
      invitation.acceptedAt = markInput.acceptedAt;
      invitation.acceptedByUserId = markInput.userId;
      return true;
    },
    async grantRole(grantInput) {
      const exists = roleGrants.some(
        (grant) =>
          grant.userId === grantInput.userId &&
          grant.roleId === grantInput.roleId &&
          grant.organisationId === grantInput.organisationId &&
          (grant.territoryId ?? null) === (grantInput.territoryId ?? null)
      );

      if (!exists) {
        roleGrants.push({ ...grantInput });
      }
    },
    async ensureMembership(membershipInput) {
      const existing = memberships.find(
        (membership) =>
          membership.userId === membershipInput.userId &&
          membership.organisationId === membershipInput.organisationId
      );

      if (existing) {
        existing.status = membershipInput.status;
        return existing;
      }

      const membership: AuthMembership = {
        id: `membership_${memberships.length + 1}`,
        userId: membershipInput.userId,
        organisationId: membershipInput.organisationId,
        status: membershipInput.status
      };
      memberships.push(membership);
      return membership;
    },
    async createSession(sessionInput) {
      const session: AuthSession = {
        id: `session_${sessions.length + 1}`,
        ...sessionInput
      };
      sessions.push(session);
      return session;
    },
    async findSessionByTokenHash(tokenHash) {
      return sessions.find((session) => session.sessionTokenHash === tokenHash) ?? null;
    },
    async revokeSession(revokeInput) {
      const session = sessions.find(
        (candidate) => candidate.id === revokeInput.sessionId
      );

      if (!session) {
        throw new Error("Session was not found.");
      }

      session.revokedAt = revokeInput.revokedAt;
    },
    async createVerificationToken(tokenInput) {
      const token: AuthVerificationToken = {
        id: `verification_${verificationTokens.length + 1}`,
        ...tokenInput
      };
      verificationTokens.push(token);
      return token;
    },
    async findVerificationTokenByHash(tokenHash) {
      return (
        verificationTokens.find((token) => token.tokenHash === tokenHash) ?? null
      );
    },
    async markVerificationTokenUsed(markInput) {
      const token = verificationTokens.find(
        (candidate) => candidate.id === markInput.tokenId
      );

      if (!token) {
        throw new Error("Verification token was not found.");
      }

      if (token.usedAt) {
        return false;
      }

      token.usedAt = markInput.usedAt;
      return true;
    }
  };
}

export function createMemoryAuditRecorder(): AuditRecorder & {
  events: Parameters<AuditRecorder["record"]>[0][];
} {
  const events: Parameters<AuditRecorder["record"]>[0][] = [];

  return {
    events,
    async record(input) {
      events.push(input);
    }
  };
}
