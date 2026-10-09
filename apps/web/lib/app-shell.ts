import { auditActions } from "@raring2go/audit";
import { resolveWorkingContext, hashToken } from "@raring2go/auth";
import { fixtureIds } from "@raring2go/db";
import {
  evaluatePermission,
  requirePermission,
  PermissionDeniedError
} from "@raring2go/permissions";
import type { AuthRepository, AuthSession } from "@raring2go/auth";
import type {
  PermissionDecision,
  PermissionRequest
} from "@raring2go/permissions";
import { isFixtureSessionAllowed, withIdentity } from "./auth-runtime";
import { getDirectory } from "./directory";
import type { Directory } from "./directory";
import { getPermissionData } from "./permission-source";

export type ShellOutcomeKind =
  | "authenticated"
  | "unauthenticated"
  | "unauthorised"
  | "invalid_context";

export type RequestedShellContext = {
  sessionKey?: string;
  sessionToken?: string;
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
  group: "today" | "portal" | "franchise" | "commercial" | "publishing" | "marketing" | "finance" | "administration";
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
    contextLevel: "territory",
    group: "today"
  },
  {
    id: "team",
    label: "My team",
    href: "/app/team",
    capability: {
      module: "franchise.team",
      action: "view"
    },
    contextLevel: "territory",
    group: "franchise"
  },
  {
    id: "territory",
    label: "Territory Dashboard",
    href: "/app/territory",
    capability: {
      module: "territory",
      action: "view"
    },
    contextLevel: "territory",
    group: "today"
  },
  {
    id: "search",
    label: "Search",
    href: "/app/search",
    capability: {
      module: "advertiser",
      action: "view"
    },
    contextLevel: "territory",
    group: "today"
  },
  {
    id: "action-centre",
    label: "Action Centre",
    href: "/app/action-centre",
    capability: {
      module: "advertiser",
      action: "view"
    },
    contextLevel: "territory",
    group: "today"
  },
  {
    id: "portal",
    label: "My Campaigns",
    href: "/app/portal",
    capability: {
      module: "portal.advertiser",
      action: "view"
    },
    contextLevel: "territory",
    group: "portal"
  },
  {
    id: "tasks",
    label: "Tasks & Approvals",
    href: "/app/tasks",
    capability: {
      module: "automation.task",
      action: "view"
    },
    contextLevel: "territory",
    group: "today"
  },
  {
    id: "franchisees",
    label: "Franchisees",
    href: "/app/franchisees",
    capability: {
      module: "franchise",
      action: "view"
    },
    contextLevel: "territory",
    group: "franchise"
  },
  {
    id: "advertisers",
    label: "Advertisers",
    href: "/app/advertisers",
    capability: {
      module: "advertiser",
      action: "view"
    },
    contextLevel: "territory",
    group: "commercial"
  },
  {
    id: "audience",
    label: "Audience",
    href: "/app/audience",
    capability: {
      module: "marketing.audience",
      action: "view"
    },
    contextLevel: "territory",
    group: "marketing"
  },
  {
    id: "preferences",
    label: "Preferences",
    href: "/app/preferences",
    capability: {
      module: "marketing.audience",
      action: "view"
    },
    contextLevel: "territory",
    group: "marketing"
  },
  {
    id: "newsletters",
    label: "Newsletters",
    href: "/app/newsletters",
    capability: {
      module: "marketing.email",
      action: "view"
    },
    contextLevel: "territory",
    group: "marketing"
  },
  {
    id: "segments",
    label: "Segments",
    href: "/app/audience/segments",
    capability: {
      module: "marketing.segment",
      action: "view"
    },
    contextLevel: "territory",
    group: "marketing"
  },
  {
    id: "journeys",
    label: "Journeys",
    href: "/app/journeys",
    capability: {
      module: "marketing.journey",
      action: "view"
    },
    contextLevel: "territory",
    group: "marketing"
  },
  {
    id: "marketing-analytics",
    label: "Marketing Analytics",
    href: "/app/marketing-analytics",
    capability: {
      module: "marketing.analytics",
      action: "view"
    },
    contextLevel: "territory",
    group: "marketing"
  },
  {
    id: "marketing-command",
    label: "Marketing Command",
    href: "/app/marketing-command",
    capability: {
      module: "marketing.analytics",
      action: "view"
    },
    contextLevel: "network",
    group: "marketing"
  },
  {
    id: "content",
    label: "Content Studio",
    href: "/app/content",
    capability: {
      module: "content",
      action: "view"
    },
    contextLevel: "territory",
    group: "publishing"
  },
  {
    id: "event-discovery",
    label: "Event Discovery",
    href: "/app/content/events",
    capability: {
      module: "content.event_suggestion",
      action: "view"
    },
    contextLevel: "territory",
    group: "publishing"
  },
  {
    id: "social",
    label: "Social Queue",
    href: "/app/social",
    capability: {
      module: "social",
      action: "view"
    },
    contextLevel: "territory",
    group: "marketing"
  },
  {
    id: "commercial-command",
    label: "Commercial Command",
    href: "/app/advertisers/command-centre",
    capability: {
      module: "advertiser.analytics",
      action: "view"
    },
    contextLevel: "network",
    group: "commercial"
  },
  {
    id: "editions",
    label: "Edition Factory",
    href: "/app/editions",
    capability: {
      module: "edition",
      action: "view"
    },
    contextLevel: "territory",
    group: "publishing"
  },
  {
    id: "finance",
    label: "Royalties",
    href: "/app/finance",
    capability: {
      module: "finance.royalty_statement",
      action: "view"
    },
    contextLevel: "territory",
    group: "finance"
  },
  {
    id: "roles",
    label: "Roles & Permissions",
    href: "/app/roles",
    capability: {
      module: "roles",
      action: "view"
    },
    contextLevel: "network",
    group: "administration"
  },
  {
    id: "connections",
    label: "Connections",
    href: "/app/settings/connections",
    capability: {
      module: "integrations",
      action: "view"
    },
    contextLevel: "territory",
    group: "administration"
  },
  {
    id: "system",
    label: "System",
    href: "/app/system",
    capability: {
      module: "system",
      action: "administer"
    },
    contextLevel: "system",
    group: "administration"
  },
  {
    id: "ai-runs",
    label: "AI Runs",
    href: "/app/system/ai",
    capability: {
      module: "ai.run",
      action: "view"
    },
    contextLevel: "territory",
    group: "administration"
  },
  {
    id: "workflows",
    label: "Workflows",
    href: "/app/system/workflows",
    capability: {
      module: "automation.workflow",
      action: "view"
    },
    contextLevel: "territory",
    group: "administration"
  },
  {
    id: "scorecard",
    label: "Scorecard",
    href: "/app/analytics",
    capability: {
      module: "analytics.scorecard",
      action: "view"
    },
    contextLevel: "territory",
    group: "franchise"
  },
  {
    id: "privacy",
    label: "Privacy Requests",
    href: "/app/privacy",
    capability: {
      module: "privacy.request",
      action: "view"
    },
    contextLevel: "system",
    group: "administration"
  },
  {
    id: "jobs",
    label: "Job Console",
    href: "/app/system/jobs",
    capability: {
      module: "system.jobs",
      action: "view"
    },
    contextLevel: "system",
    group: "administration"
  },
  {
    id: "activity",
    label: "Audit Activity",
    href: "/app/activity",
    capability: {
      module: "system",
      action: "administer"
    },
    contextLevel: "system",
    group: "administration"
  }
];

export const navigationGroups: Array<{ id: NavigationDescriptor["group"]; label: string }> = [
  { id: "portal", label: "Your account" },
  { id: "today", label: "Today" },
  { id: "franchise", label: "Franchise" },
  { id: "commercial", label: "Commercial" },
  { id: "publishing", label: "Publishing" },
  { id: "marketing", label: "Marketing" },
  { id: "finance", label: "Finance" },
  { id: "administration", label: "Administration" }
];

const sessionsByKey: Record<string, AuthSession> = {
  superadmin: {
    id: "session_superadmin",
    userId: fixtureIds.users.superAdmin,
    sessionTokenHash: "fixture_superadmin",
    assuranceLevel: "standard",
    expiresAt: new Date("2099-01-01T00:00:00.000Z")
  },
  advertiser: {
    id: "session_advertiser",
    userId: fixtureIds.users.advertiserUser,
    sessionTokenHash: "fixture_advertiser",
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

export async function resolveShell(
  request: RequestedShellContext,
  repository?: AuthRepository
): Promise<ShellOutcome> {
  // Without an explicit repository (tests pass one) identity is read from Postgres.
  if (repository) return resolveShellWith(request, repository);
  return withIdentity(({ repository: identity }) => resolveShellWith(request, identity));
}

async function resolveShellWith(request: RequestedShellContext, repository: AuthRepository): Promise<ShellOutcome> {
  const permissionData = await getPermissionData();
  const directory = getDirectory();
  const session = await resolveRequestedSession(request, repository);

  if (!session) {
    return {
      kind: "unauthenticated",
      title: "Sign in required",
      message: "The Raring2go operating system shell requires an active session."
    };
  }

  const defaultContext = await defaultContextForUser(repository, directory, session.userId);
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
      displayName: (await directory.userName(session.userId)) ?? "Raring2go user",
      activeContext: {
        organisationId: context.organisationId,
        organisationName: (await directory.organisationName(context.organisationId)) ?? "Unknown organisation",
        territoryId: context.territoryId,
        territoryName: context.territoryId ? ((await directory.territoryName(context.territoryId)) ?? "Unknown territory") : undefined
      },
      availableContexts: await contextsForUser(repository, directory, session.userId),
      navigation: shellNavigation.filter((item) => decisions[item.id]?.allowed),
      decisions
    };
  } catch (error) {
    return invalidContext(
      error instanceof Error ? error.message : "The requested context is invalid."
    );
  }
}

async function resolveRequestedSession(
  request: RequestedShellContext,
  repository: AuthRepository
): Promise<AuthSession | undefined> {
  if (request.sessionToken) {
    return (
      (await repository.findSessionByTokenHash(hashToken(request.sessionToken))) ??
      undefined
    );
  }

  if (request.sessionKey && isFixtureSessionAllowed()) {
    return sessionsByKey[request.sessionKey];
  }

  return undefined;
}

export async function requireShellPermission(
  request: RequestedShellContext,
  capability: ShellCapability
) {
  const permissionData = await getPermissionData();
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

/**
 * Where a user lands when they have not chosen a context: their first active organisation (oldest
 * membership), and for a franchise organisation its first territory. Derived from the user's own
 * memberships, never from a fixed list, so any invited user gets a working default.
 */
async function defaultContextForUser(repository: AuthRepository, directory: Directory, userId: string) {
  const memberships = (await repository.findMembershipsForUser(userId)).filter((membership) => membership.status === "active");
  const first = memberships[0];

  if (!first) {
    return undefined;
  }

  const [territory] = await directory.territoriesOwnedBy(first.organisationId);
  return territory ? { organisationId: first.organisationId, territoryId: territory.id } : { organisationId: first.organisationId };
}

async function contextsForUser(repository: AuthRepository, directory: Directory, userId: string) {
  const memberships = await repository.findMembershipsForUser(userId);
  const active = memberships.filter((membership) => membership.userId === userId && membership.status === "active");

  const contexts = await Promise.all(
    active.map(async (membership) => {
      const organisationName = (await directory.organisationName(membership.organisationId)) ?? "Unknown organisation";
      const owned = await directory.territoriesOwnedBy(membership.organisationId);

      if (owned.length === 0) {
        return [{ organisationId: membership.organisationId, organisationName }];
      }

      return owned.map((territory) => ({
        organisationId: membership.organisationId,
        organisationName,
        territoryId: territory.id,
        territoryName: territory.name
      }));
    })
  );

  return contexts.flat();
}
