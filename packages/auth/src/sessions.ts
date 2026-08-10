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
