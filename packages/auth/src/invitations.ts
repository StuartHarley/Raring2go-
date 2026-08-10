import { auditActions } from "@raring2go/audit";
import { normalizeEmail } from "./email";
import { findOrCreateUserByEmail } from "./identity";
import { hashToken } from "./tokens";
import type { AuditRecorder, AuthRepository } from "./types";

export async function acceptInvitation(
  repository: AuthRepository,
  audit: AuditRecorder,
  input: {
    token: string;
    email: string;
    displayName?: string;
    now?: Date;
  }
) {
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);
  const tokenHash = hashToken(input.token);
  const invitation = await repository.findInvitationByTokenHash(tokenHash);

  if (!invitation) {
    throw new Error("Invitation was not found.");
  }

  if (invitation.status !== "pending" || invitation.acceptedAt) {
    throw new Error("Invitation has already been used.");
  }

  if (invitation.revokedAt || invitation.expiresAt <= now) {
    throw new Error("Invitation is no longer valid.");
  }

  if (normalizeEmail(invitation.email) !== email) {
    throw new Error("Invitation email does not match.");
  }

  const user = await findOrCreateUserByEmail(repository, {
    email,
    displayName: input.displayName
  });

  const membership = await repository.ensureMembership({
    userId: user.id,
    organisationId: invitation.organisationId,
    status: "active"
  });

  await repository.markInvitationAccepted({
    invitationId: invitation.id,
    userId: user.id,
    acceptedAt: now
  });

  await audit.record({
    action: auditActions.authInviteAccept,
    actor: {
      type: "human",
      userId: user.id
    },
    entity: {
      type: "auth_invitation",
      id: invitation.id
    },
    scope: {
      organisationId: invitation.organisationId,
      territoryId: invitation.territoryId ?? undefined
    },
    metadata: {
      email,
      membershipId: membership.id
    }
  });

  return {
    user,
    membership
  };
}
