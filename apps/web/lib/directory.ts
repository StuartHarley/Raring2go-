import { createDb, foundationSeed, franchises, organisations, territories, users } from "@raring2go/db";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Names and ownership the shell needs: who someone is, what an organisation is called, which
 * territories a franchise organisation owns. Read from the database at runtime; unit tests use the
 * seeded fixtures through `setDirectoryForTests`.
 */
export type Directory = {
  userName(userId: string): Promise<string | undefined>;
  organisationName(organisationId: string): Promise<string | undefined>;
  territoryName(territoryId: string): Promise<string | undefined>;
  territoriesOwnedBy(organisationId: string): Promise<Array<{ id: string; name: string }>>;
  listTerritories(): Promise<Array<{ id: string; name: string }>>;
  primaryTerritoryOfFranchise(franchiseId: string): Promise<string | null>;
};

type Snapshot = {
  organisations: Map<string, string>;
  territories: Array<{ id: string; name: string; franchiseOrganisationId: string | null }>;
  franchisePrimary: Map<string, string>;
  loadedAt: number;
};

const TTL_MS = 30_000;
const key = Symbol.for("raring2go.directory-snapshot");
const scope = globalThis as typeof globalThis & { [key]?: Snapshot };

async function snapshot(): Promise<Snapshot> {
  const cached = scope[key];
  if (cached && Date.now() - cached.loadedAt < TTL_MS) return cached;

  const { db, sql } = createDb();
  try {
    const [orgRows, territoryRows, franchiseRows] = await Promise.all([
      db.select({ id: organisations.id, name: organisations.name }).from(organisations).where(isNull(organisations.deletedAt)),
      db.select({ id: territories.id, name: territories.name, franchiseOrganisationId: territories.franchiseOrganisationId }).from(territories).where(isNull(territories.deletedAt)),
      db.select({ id: franchises.id, primaryTerritoryId: franchises.primaryTerritoryId }).from(franchises).where(isNull(franchises.deletedAt))
    ]);
    const fresh: Snapshot = {
      organisations: new Map(orgRows.map((row) => [row.id, row.name])),
      territories: territoryRows,
      franchisePrimary: new Map(franchiseRows.map((row) => [row.id, row.primaryTerritoryId])),
      loadedAt: Date.now()
    };
    scope[key] = fresh;
    return fresh;
  } finally {
    await sql.end();
  }
}

/** Forget the cached names after an organisation or territory is created or renamed. */
export function invalidateDirectory() {
  scope[key] = undefined;
}

export const databaseDirectory: Directory = {
  async userName(userId) {
    const { db, sql } = createDb();
    try {
      const [row] = await db.select({ name: users.displayName, email: users.email }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1);
      return row ? (row.name ?? row.email) : undefined;
    } finally {
      await sql.end();
    }
  },
  async organisationName(organisationId) {
    return (await snapshot()).organisations.get(organisationId);
  },
  async territoryName(territoryId) {
    return (await snapshot()).territories.find((territory) => territory.id === territoryId)?.name;
  },
  async territoriesOwnedBy(organisationId) {
    return (await snapshot()).territories.filter((territory) => territory.franchiseOrganisationId === organisationId).map(({ id, name }) => ({ id, name }));
  },
  async listTerritories() {
    return (await snapshot()).territories.map(({ id, name }) => ({ id, name }));
  },
  async primaryTerritoryOfFranchise(franchiseId) {
    return (await snapshot()).franchisePrimary.get(franchiseId) ?? null;
  }
};

export const fixtureDirectory: Directory = {
  async userName(userId) {
    return foundationSeed.users.find((user) => user.id === userId)?.displayName;
  },
  async organisationName(organisationId) {
    return foundationSeed.organisations.find((organisation) => organisation.id === organisationId)?.name;
  },
  async territoryName(territoryId) {
    return foundationSeed.territories.find((territory) => territory.id === territoryId)?.name;
  },
  async territoriesOwnedBy(organisationId) {
    return foundationSeed.territories.filter((territory) => territory.franchiseOrganisationId === organisationId).map(({ id, name }) => ({ id, name }));
  },
  async listTerritories() {
    return foundationSeed.territories.map(({ id, name }) => ({ id, name }));
  },
  async primaryTerritoryOfFranchise(franchiseId) {
    return foundationSeed.franchises.find((franchise) => franchise.id === franchiseId)?.primaryTerritoryId ?? null;
  }
};

let override: Directory | undefined;

export function getDirectory(): Directory {
  return override ?? databaseDirectory;
}

export function setDirectoryForTests(directory: Directory | undefined) {
  if (process.env.NODE_ENV === "production") throw new Error("Fixture directory is not available in production.");
  override = directory;
}
