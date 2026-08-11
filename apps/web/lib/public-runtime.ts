import {
  defaultPublicTerritorySlug,
  getPublicDiscovery,
  getPublicHomepage,
  territoryFromSlug,
  type PublicDiscoveryFilters,
  type PublicDiscoveryKind
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
