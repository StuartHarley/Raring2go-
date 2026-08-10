import type {
  AuthRepository,
  AuthSession,
  AuthenticationAssuranceLevel,
  WorkingContext
} from "./types";

export async function resolveWorkingContext(
  repository: AuthRepository,
  input: {
    session: AuthSession;
    organisationId: string;
    territoryId?: string;
    now?: Date;
    requiredAssuranceLevel?: AuthenticationAssuranceLevel;
  }
): Promise<WorkingContext> {
  const now = input.now ?? new Date();

  if (input.session.revokedAt) {
    throw new Error("Session has been revoked.");
  }

  if (input.session.expiresAt <= now) {
    throw new Error("Session has expired.");
  }

  if (
    input.requiredAssuranceLevel === "mfa" &&
    input.session.assuranceLevel !== "mfa"
  ) {
    throw new Error("Higher authentication assurance is required.");
  }

  const memberships = await repository.findMembershipsForUser(input.session.userId);
  const membership = memberships.find(
    (candidate) =>
      candidate.organisationId === input.organisationId &&
      candidate.status === "active"
  );

  if (!membership) {
    throw new Error("User is not a member of the requested organisation.");
  }

  if (input.territoryId) {
    const territory = await repository.findTerritoryById(input.territoryId);

    if (!territory || territory.status !== "active") {
      throw new Error("Requested territory is not available.");
    }

    if (territory.franchiseOrganisationId !== input.organisationId) {
      throw new Error("Requested territory is outside the organisation context.");
    }
  }

  return {
    userId: input.session.userId,
    organisationId: input.organisationId,
    territoryId: input.territoryId,
    assuranceLevel: input.session.assuranceLevel
  };
}
