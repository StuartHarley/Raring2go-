import { auditActions } from "@raring2go/audit";
import { hashToken } from "./tokens";
import type {
  AuditRecorder,
  AuthRepository,
  AuthenticationAssuranceLevel
} from "./types";

export async function createSession(
  repository: AuthRepository,
  audit: AuditRecorder,
  input: {
    userId: string;
    token: string;
    expiresAt: Date;
    assuranceLevel?: AuthenticationAssuranceLevel;
  }
) {
  const session = await repository.createSession({
    userId: input.userId,
    sessionTokenHash: hashToken(input.token),
    assuranceLevel: input.assuranceLevel ?? "standard",
    expiresAt: input.expiresAt
  });

  await audit.record({
    action: auditActions.authSignIn,
    actor: {
      type: "human",
      userId: input.userId
    },
    entity: {
      type: "auth_session",
      id: session.id
    },
    metadata: {
      assuranceLevel: session.assuranceLevel
    }
  });

  return session;
}

export async function revokeSession(
  repository: AuthRepository,
  audit: AuditRecorder,
  input: {
    token: string;
    now?: Date;
  }
) {
  const now = input.now ?? new Date();
  const session = await repository.findSessionByTokenHash(hashToken(input.token));

  if (!session || session.revokedAt) {
    throw new Error("Session was not found.");
  }

  await repository.revokeSession({
    sessionId: session.id,
    revokedAt: now
  });

  await audit.record({
    action: auditActions.authSessionRevoke,
    actor: {
      type: "human",
      userId: session.userId
    },
    entity: {
      type: "auth_session",
      id: session.id
    }
  });
}

/**
 * Account recovery from a lost or shared device: ends every session the user has, including this one. The user
 * is identified only by proving they hold a live session, so nobody can end another person's sessions.
 */
export async function revokeAllSessions(
  repository: AuthRepository,
  audit: AuditRecorder,
  input: { token: string; now?: Date }
) {
  const now = input.now ?? new Date();
  const session = await repository.findSessionByTokenHash(hashToken(input.token));

  if (!session || session.revokedAt || session.expiresAt <= now) {
    throw new Error("Session was not found.");
  }

  const ended = await repository.revokeAllSessionsForUser({ userId: session.userId, revokedAt: now });

  await audit.record({
    action: auditActions.authSessionRevokeAll,
    actor: { type: "human", userId: session.userId },
    entity: { type: "user", id: session.userId },
    after: { sessionsEnded: ended }
  });

  return { sessionsEnded: ended };
}
