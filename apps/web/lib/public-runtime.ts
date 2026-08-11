import {
  defaultPublicTerritorySlug,
  getPublicCommercialDiscovery,
  getPublicDiscovery,
  getPublicHomepage,
  getPublicMagazine,
  getPublicParentHub,
  territoryFromSlug,
  type PublicDiscoveryFilters,
  type PublicDiscoveryKind,
  type PublicCommercialKind
} from "@raring2go/public";
import { createDb } from "@raring2go/db";

export { defaultPublicTerritorySlug, territoryFromSlug };

export async function readPublicHomepage(slug: string) {
  const { db, sql } = createDb();

  try {
    return await getPublicHomepage(db, slug);
  } finally {
    await sql.end();
  }
}

export async function readPublicDiscovery(
  slug: string,
  kind: PublicDiscoveryKind,
  filters: PublicDiscoveryFilters = {}
) {
  const { db, sql } = createDb();

  try {
    return await getPublicDiscovery(db, slug, kind, filters);
  } finally {
    await sql.end();
  }
}

export async function readPublicCommercialDiscovery(slug: string, kind: PublicCommercialKind) {
  const { db, sql } = createDb();

  try {
    return await getPublicCommercialDiscovery(db, slug, kind);
  } finally {
    await sql.end();
  }
}

export async function readPublicMagazine(slug: string) {
  const { db, sql } = createDb();

  try {
    return await getPublicMagazine(db, slug);
  } finally {
    await sql.end();
  }
}

export async function readPublicParentHub(slug: string, contactId?: string | null) {
  const { db, sql } = createDb();

  try {
    return await getPublicParentHub(db, slug, contactId);
  } finally {
    await sql.end();
  }
}
