import { createDb, fixturePermissionData } from "@raring2go/db";
import { createPermissionDataSource, loadPermissionData } from "@raring2go/permissions";
import type { PermissionData, PermissionDataSource } from "@raring2go/permissions";

/**
 * The one place the application obtains authorisation data. Roles, grants and assignments live in
 * the database, so Super Admin can change them without a deploy and every check (navigation, pages,
 * server actions, route handlers, background services) reads the same rules.
 *
 * The cache is per server instance. `invalidatePermissionData()` takes effect immediately on the
 * instance that made a change; other instances see it within `PERMISSION_CACHE_TTL_MS` (default 15s),
 * which is the longest a revoked grant can keep working elsewhere.
 */
const cacheKey = Symbol.for("raring2go.permission-data-source");
const globalScope = globalThis as typeof globalThis & { [cacheKey]?: PermissionDataSource };

async function loadFromDatabase(): Promise<PermissionData> {
  const { db, sql } = createDb();
  try {
    return await loadPermissionData(db);
  } finally {
    await sql.end();
  }
}

function source(): PermissionDataSource {
  // Held on globalThis so development hot reloads do not leave a stale cache behind.
  globalScope[cacheKey] ??= createPermissionDataSource({ load: loadFromDatabase, ttlMs: Number(process.env.PERMISSION_CACHE_TTL_MS ?? 15_000) });
  return globalScope[cacheKey];
}

let testOverride: PermissionData | undefined;

export async function getPermissionData(): Promise<PermissionData> {
  return testOverride ?? source().get();
}

export function invalidatePermissionData() {
  source().invalidate();
}

/**
 * Unit tests run without a database, against the same seeded grants the database holds. Never
 * available in production builds, so a stray call cannot replace real authorisation data.
 */
export function setFixturePermissionData(data: PermissionData | undefined = fixturePermissionData() as PermissionData) {
  if (process.env.NODE_ENV === "production") throw new Error("Fixture permission data is not available in production.");
  testOverride = data;
}

export function setDatabasePermissionData() {
  testOverride = undefined;
}
