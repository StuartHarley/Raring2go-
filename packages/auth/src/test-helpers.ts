import type {
  AuditRecorder,
  AuthInvitation,
  AuthMembership,
  AuthRepository,
  AuthSession,
  AuthTerritory,
  AuthUser
} from "./types";

export function createMemoryAuthRepository(input?: {
  users?: AuthUser[];
  memberships?: AuthMembership[];
  territories?: AuthTerritory[];
  invitations?: AuthInvitation[];
  sessions?: AuthSession[];
}): AuthRepository & {
  users: AuthUser[];
  memberships: AuthMembership[];
  sessions: AuthSession[];
} {
  const users = [...(input?.users ?? [])];
  const memberships = [...(input?.memberships ?? [])];
  const territories = [...(input?.territories ?? [])];
  const invitations = [...(input?.invitations ?? [])];
  const sessions = [...(input?.sessions ?? [])];

  return {
    users,
    memberships,
    sessions,
    async findUserByEmail(email) {
      return users.find((user) => user.email === email) ?? null;
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

      invitation.status = "accepted";
      invitation.acceptedAt = markInput.acceptedAt;
      invitation.acceptedByUserId = markInput.userId;
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
