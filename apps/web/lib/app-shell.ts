import { auditActions } from "@raring2go/audit";
import { resolveWorkingContext } from "@raring2go/auth";
import { fixtureIds, foundationSeed } from "@raring2go/db";
import {
  evaluatePermission,
  requirePermission,
  PermissionDeniedError
} from "@raring2go/permissions";
import type {
  AuthMembership,
  AuthRepository,
  AuthSession,
  AuthTerritory
} from "@raring2go/auth";
import type {
  PermissionData,
  PermissionDecision,
  PermissionRequest
} from "@raring2go/permissions";

export type ShellOutcomeKind =
  | "authenticated"
  | "unauthenticated"
  | "unauthorised"
  | "invalid_context";

export type RequestedShellContext = {
  sessionKey?: string;
  organisationId?: string;
  territoryId?: string;
};

export type ShellCapability = {
  module: string;
  action: string;
};

export type NavigationDescriptor = {
  id: string;
  label: string;
  href: string;
  capability: ShellCapability;
  contextLevel: "territory" | "network" | "system";
};

export type ResolvedShell = {
  kind: "authenticated";
  userId: string;
  displayName: string;
  activeContext: {
    organisationId: string;
    organisationName: string;
    territoryId?: string;
    territoryName?: string;
  };
  availableContexts: Array<{
    organisationId: string;
    organisationName: string;
    territoryId?: string;
    territoryName?: string;
  }>;
  navigation: NavigationDescriptor[];
  decisions: Record<string, PermissionDecision>;
};

export type ShellOutcome =
  | ResolvedShell
  | {
      kind: Exclude<ShellOutcomeKind, "authenticated">;
      title: string;
      message: string;
      auditAction?: string;
    };

export const shellNavigation: NavigationDescriptor[] = [
  {
    id: "today",
    label: "My Today",
    href: "/app",
    capability: {
      module: "territory",
      action: "view"
    },
    contextLevel: "territory"
  },
  {
    id: "territory",
    label: "Territory Dashboard",
    href: "/app/territory",
    capability: {
      module: "territory",
      action: "view"
    },
    contextLevel: "territory"
  },
  {
    id: "roles",
    label: "Roles & Permissions",
    href: "/app/roles",
    capability: {
      module: "roles",
      action: "view"
    },
    contextLevel: "network"
  },
  {
    id: "system",
    label: "System",
    href: "/app/system",
    capability: {
      module: "system",
      action: "administer"
    },
    contextLevel: "system"
  }
];

const sessionsByKey: Record<string, AuthSession> = {
  superadmin: {
    id: "session_superadmin",
    userId: fixtureIds.users.superAdmin,
    sessionTokenHash: "fixture_superadmin",
    assuranceLevel: "standard",
    expiresAt: new Date("2099-01-01T00:00:00.000Z")
  },
  franchisee: {
    id: "session_franchisee",
    userId: fixtureIds.users.franchisee,
    sessionTokenHash: "fixture_franchisee",
    assuranceLevel: "standard",
    expiresAt: new Date("2099-01-01T00:00:00.000Z")
  }
};

const memberships: AuthMembership[] = [
  {
    id: "fixture_membership_superadmin",
    userId: fixtureIds.users.superAdmin,
    organisationId: fixtureIds.organisations.hq,
    status: "active"
  },
  {
    id: "fixture_membership_franchisee",
    userId: fixtureIds.users.franchisee,
    organisationId: fixtureIds.organisations.franchise,
    status: "active"
  },
  {
    id: "fixture_membership_franchisee_advertiser",
    userId: fixtureIds.users.franchisee,
    organisationId: fixtureIds.organisations.advertiser,
    status: "active"
  }
];

const territories: AuthTerritory[] = foundationSeed.territories.map((territory) => ({
  ...territory,
  status: "active"
}));

export const fixtureAuthRepository: AuthRepository = {
  async findUserByEmail() {
    return null;
  },
  async createUser() {
    throw new Error("Fixture shell repository does not create users.");
  },
  async findMembershipsForUser(userId) {
    return memberships.filter((membership) => membership.userId === userId);
  },
  async findTerritoryById(territoryId) {
    return territories.find((territory) => territory.id === territoryId) ?? null;
  },
  async findInvitationByTokenHash() {
    return null;
  },
  async markInvitationAccepted() {},
  async ensureMembership() {
    throw new Error("Fixture shell repository does not modify memberships.");
  },
  async createSession() {
    throw new Error("Fixture shell repository does not create sessions.");
  },
  async findSessionByTokenHash(tokenHash) {
    return Object.values(sessionsByKey).find(
      (session) => session.sessionTokenHash === tokenHash
    ) ?? null;
  },
  async revokeSession() {}
};

const permissionData: PermissionData = {
  roleAssignments: [
    {
      id: "fixture_assignment_superadmin",
      userId: fixtureIds.users.superAdmin,
      roleId: fixtureIds.roles.superAdmin,
      organisationId: fixtureIds.organisations.hq
    },
    {
      id: "fixture_assignment_hq",
      userId: fixtureIds.users.superAdmin,
      roleId: fixtureIds.roles.hqAdmin,
      organisationId: fixtureIds.organisations.hq
    },
    {
      id: "fixture_assignment_franchisee",
      userId: fixtureIds.users.franchisee,
      roleId: fixtureIds.roles.franchisee,
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield
    }
  ],
  rolePermissions: [
    {
      roleId: fixtureIds.roles.superAdmin,
      permissionId: fixtureIds.permissions.systemAdminister,
      scope: "system",
      constraints: {}
    },
    {
      roleId: fixtureIds.roles.hqAdmin,
      permissionId: fixtureIds.permissions.rolesView,
      scope: "network",
      constraints: {}
    },
    {
      roleId: fixtureIds.roles.franchisee,
      permissionId: fixtureIds.permissions.territoryView,
      scope: "own_territory",
      constraints: {}
    }
  ].map((grant) => {
    const permission = foundationSeed.permissions.find(
      (candidate) => candidate.id === grant.permissionId
    );

    if (!permission) {
      throw new Error("Fixture permission seed is inconsistent.");
    }

    return {
      roleId: grant.roleId,
      permission,
      scope: grant.scope,
      constraints: grant.constraints
    };
  }),
  territories: [...foundationSeed.territories]
};

export async function resolveShell(
  request: RequestedShellContext,
  repository = fixtureAuthRepository
): Promise<ShellOutcome> {
  const session = request.sessionKey ? sessionsByKey[request.sessionKey] : undefined;

  if (!session) {
    return {
      kind: "unauthenticated",
      title: "Sign in required",
      message: "The Raring2go operating system shell requires an active session."
    };
  }

  const defaultContext = defaultContextForUser(session.userId);
  const organisationId = request.organisationId ?? defaultContext?.organisationId;
  const territoryId = request.territoryId ?? defaultContext?.territoryId;

  if (!organisationId) {
    return invalidContext("No valid organisation context was requested.");
  }

  try {
    const context = await resolveWorkingContext(repository, {
      session,
      organisationId,
      territoryId
    });

    const decisions = Object.fromEntries(
      shellNavigation.map((item) => [
        item.id,
        evaluatePermission(toPermissionRequest(item.capability, context), permissionData)
      ])
    );

    return {
      kind: "authenticated",
      userId: session.userId,
      displayName: displayNameForUser(session.userId),
      activeContext: {
        organisationId: context.organisationId,
        organisationName: organisationName(context.organisationId),
        territoryId: context.territoryId,
        territoryName: context.territoryId
          ? territoryName(context.territoryId)
          : undefined
      },
      availableContexts: contextsForUser(session.userId),
      navigation: shellNavigation.filter((item) => decisions[item.id]?.allowed),
      decisions
    };
  } catch (error) {
    return invalidContext(
      error instanceof Error ? error.message : "The requested context is invalid."
    );
  }
}

export async function requireShellPermission(
  request: RequestedShellContext,
  capability: ShellCapability
) {
  const shell = await resolveShell(request);

  if (shell.kind !== "authenticated") {
    throw new ShellAccessError(shell.kind, shell.message);
  }

  try {
    requirePermission(
      toPermissionRequest(capability, {
        userId: shell.userId,
        organisationId: shell.activeContext.organisationId,
        territoryId: shell.activeContext.territoryId
      }),
      permissionData
    );
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      throw new ShellAccessError("unauthorised", error.decision.explanation);
    }

    throw error;
  }

  return shell;
}

export class ShellAccessError extends Error {
  readonly kind: Exclude<ShellOutcomeKind, "authenticated">;

  constructor(kind: Exclude<ShellOutcomeKind, "authenticated">, message: string) {
    super(message);
    this.name = "ShellAccessError";
    this.kind = kind;
  }
}

function toPermissionRequest(
  capability: ShellCapability,
  context: {
    userId: string;
    organisationId: string;
    territoryId?: string;
  }
): PermissionRequest {
  return {
    userId: context.userId,
    module: capability.module,
    action: capability.action,
    context: {
      organisationId: context.organisationId,
      territoryId: context.territoryId
    }
  };
}

function invalidContext(message: string): ShellOutcome {
  return {
    kind: "invalid_context",
    title: "Invalid context",
    message,
    auditAction: auditActions.authSecurityChange
  };
}

function defaultContextForUser(userId: string) {
  if (userId === fixtureIds.users.superAdmin) {
    return {
      organisationId: fixtureIds.organisations.hq
    };
  }

  if (userId === fixtureIds.users.franchisee) {
    return {
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield
    };
  }

  return undefined;
}

function contextsForUser(userId: string) {
  return memberships
    .filter((membership) => membership.userId === userId && membership.status === "active")
    .flatMap((membership) => {
      const ownedTerritories = foundationSeed.territories.filter(
        (territory) => territory.franchiseOrganisationId === membership.organisationId
      );

      if (ownedTerritories.length === 0) {
        return [
          {
            organisationId: membership.organisationId,
            organisationName: organisationName(membership.organisationId)
          }
        ];
      }

      return ownedTerritories.map((territory) => ({
        organisationId: membership.organisationId,
        organisationName: organisationName(membership.organisationId),
        territoryId: territory.id,
        territoryName: territory.name
      }));
    });
}

function displayNameForUser(userId: string) {
  return (
    foundationSeed.users.find((user) => user.id === userId)?.displayName ??
    "Raring2go user"
  );
}

function organisationName(organisationId: string) {
  return (
    foundationSeed.organisations.find((organisation) => organisation.id === organisationId)
      ?.name ?? "Unknown organisation"
  );
}

function territoryName(territoryId: string) {
  return (
    foundationSeed.territories.find((territory) => territory.id === territoryId)?.name ??
    "Unknown territory"
  );
}
