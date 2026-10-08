import { auditActions } from "@raring2go/audit";
import { normalizeEmail } from "./email";
import { findOrCreateUserByEmail } from "./identity";
import { createSession } from "./sessions";
import { hashToken } from "./tokens";
import type { AuditRecorder, AuthRepository, AuthTokenRepository } from "./types";

const defaultMagicLinkTtlMs = 15 * 60 * 1000;
const defaultSessionTtlMs = 30 * 24 * 60 * 60 * 1000;

export type MagicLinkDelivery = {
  email: string;
  token: string;
  expiresAt: Date;
  url?: string;
};

export async function requestPasswordlessSignIn(
  repository: AuthTokenRepository,
  audit: AuditRecorder,
  input: {
    email: string;
    token: string;
    now?: Date;
    ttlMs?: number;
    returnTo?: string;
    baseUrl?: string;
  }
): Promise<MagicLinkDelivery> {
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? defaultMagicLinkTtlMs));

  await repository.createVerificationToken({
    identifier: email,
    tokenHash: hashToken(input.token),
    purpose: "sign_in",
    expiresAt
  });

  await audit.record({
    action: auditActions.authEmailVerify,
    actor: {
      type: "system",
      systemId: "auth.passwordless"
    },
    entity: {
      type: "auth_verification_token"
    },
    metadata: {
      email,
      purpose: "sign_in",
      returnTo: input.returnTo
    }
  });

  return {
    email,
    token: input.token,
    expiresAt,
    url: input.baseUrl
      ? `${input.baseUrl}/sign-in/verify?token=${encodeURIComponent(input.token)}`
      : undefined
  };
}

export async function consumePasswordlessSignIn(
  repository: AuthRepository & AuthTokenRepository,
  audit: AuditRecorder,
  input: {
    token: string;
    sessionToken: string;
    now?: Date;
    sessionTtlMs?: number;
  }
) {
  const now = input.now ?? new Date();
  const verification = await repository.findVerificationTokenByHash(
    hashToken(input.token)
  );

  if (!verification) {
    throw new Error("Sign-in token was not found.");
  }

  if (verification.purpose !== "sign_in") {
    throw new Error("Sign-in token purpose is invalid.");
  }

  if (verification.usedAt) {
    throw new Error("Sign-in token has already been used.");
  }

  if (verification.expiresAt <= now) {
    throw new Error("Sign-in token has expired.");
  }

  // Anyone can sign in by email (parents self-register); an account holds no access until it is
  // given a membership and roles. A disabled account's outstanding links stop working.
  const user = await findOrCreateUserByEmail(repository, {
    email: verification.identifier
  });

  if (user.status !== "active") {
    throw new Error("Sign-in is not available for this account.");
  }

  // Claim before creating the session: of two simultaneous uses of one link, exactly one gets in.
  const claimed = await repository.markVerificationTokenUsed({
    tokenId: verification.id,
    usedAt: now
  });

  if (!claimed) {
    throw new Error("Sign-in token has already been used.");
  }

  const session = await createSession(repository, audit, {
    userId: user.id,
    token: input.sessionToken,
    expiresAt: new Date(now.getTime() + (input.sessionTtlMs ?? defaultSessionTtlMs))
  });

  return {
    user,
    session
  };
}
