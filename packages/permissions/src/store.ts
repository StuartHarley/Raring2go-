import { delegations, permissions, rolePermissions, roles, territories, userRoleAssignments } from "@raring2go/db";
import type { createDb } from "@raring2go/db";
import { and, eq, isNull } from "drizzle-orm";
import type { PermissionData } from "./types";

type Db = Pick<ReturnType<typeof createDb>["db"], "select">;

/**
 * Read the access-control tables into the shape the evaluator takes. This is the only place the
 * application turns database rows into authorisation data: roles that are soft-deleted grant nothing,
 * and date-bounded assignments and delegations are passed through so the evaluator applies their
 * windows at decision time.
 */
export async function loadPermissionData(db: Db): Promise<PermissionData> {
  const [grantRows, assignmentRows, delegationRows, territoryRows] = await Promise.all([
    db
      .select({ roleId: rolePermissions.roleId, permissionId: permissions.id, module: permissions.module, action: permissions.action, scope: rolePermissions.scope, constraints: rolePermissions.constraints })
      .from(rolePermissions)
      .innerJoin(roles, and(eq(roles.id, rolePermissions.roleId), isNull(roles.deletedAt)))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)),
    db.select().from(userRoleAssignments),
    db.select().from(delegations),
    db.select().from(territories).where(isNull(territories.deletedAt))
  ]);

  return {
    roleAssignments: assignmentRows.map((row) => ({ id: row.id, userId: row.userId, roleId: row.roleId, organisationId: row.organisationId, territoryId: row.territoryId, startsAt: row.startsAt, endsAt: row.endsAt })),
    rolePermissions: grantRows.map((row) => ({ roleId: row.roleId, permission: { id: row.permissionId, module: row.module, action: row.action }, scope: row.scope, constraints: row.constraints })),
    delegations: delegationRows.map((row) => ({ id: row.id, fromUserId: row.fromUserId, toUserId: row.toUserId, organisationId: row.organisationId, territoryId: row.territoryId, startsAt: row.startsAt, endsAt: row.endsAt })),
    territories: territoryRows.map((row) => ({ id: row.id, franchiseOrganisationId: row.franchiseOrganisationId, status: row.status }))
  };
}

export type PermissionDataSource = {
  /** The current permission data: cached for a short time, so a hot path does not query on every check. */
  get(): Promise<PermissionData>;
  /** Drop the cached copy. Called after any change to roles, grants or assignments. */
  invalidate(): void;
};

/**
 * A small time-bounded cache around a loader. Concurrent callers share one in-flight load. A failed
 * load is never cached, and if a refresh fails while an older copy exists the older copy is NOT served:
 * authorisation data that cannot be refreshed past its TTL is treated as unavailable, because quietly
 * honouring a revoked grant is the failure that matters.
 *
 * `invalidate()` clears this instance only. Other serverless instances pick a change up when their own
 * copy expires, so `ttlMs` is the longest a revoked grant can keep working elsewhere (default 15s).
 */
export function createPermissionDataSource(options: { load: () => Promise<PermissionData>; ttlMs?: number; now?: () => number }): PermissionDataSource {
  const ttlMs = options.ttlMs ?? 15_000;
  const now = options.now ?? Date.now;
  let cached: { data: PermissionData; loadedAt: number } | undefined;
  let inflight: { promise: Promise<PermissionData>; generation: number } | undefined;
  let generation = 0;

  return {
    async get() {
      if (cached && now() - cached.loadedAt < ttlMs) return cached.data;
      // A load that started before the last invalidation may predate the change, so it is not shared.
      if (!inflight || inflight.generation !== generation) {
        const startedGeneration = generation;
        const promise: Promise<PermissionData> = options
          .load()
          .then((data) => {
            if (startedGeneration === generation) cached = { data, loadedAt: now() };
            return data;
          })
          .finally(() => {
            if (inflight?.promise === promise) inflight = undefined;
          });
        inflight = { promise, generation: startedGeneration };
      }
      return inflight.promise;
    },
    invalidate() {
      generation += 1;
      cached = undefined;
    }
  };
}
