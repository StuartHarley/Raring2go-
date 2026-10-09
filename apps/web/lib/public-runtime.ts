import {
  defaultPublicTerritorySlug,
  getPublicCommercialDiscovery,
  getPublicDiscovery,
  getPublicBusiness,
  getPublicContentDetail,
  getPublicHomepage,
  getPublicMagazineEdition,
  getPublicMagazinePage,
  getPublicMagazine,
  getPublicParentHub,
  getPublicRecommendations,
  publicSeoRoutes,
  publicTerritoryStructuredData,
  territoryFromSlug,
  type PublicContentSection,
  type PublicDiscoveryFilters,
  type PublicDiscoveryKind,
  type PublicCommercialKind
} from "@raring2go/public";
import { createDb } from "@raring2go/db";

export { defaultPublicTerritorySlug, territoryFromSlug };
export { publicSeoRoutes, publicTerritoryStructuredData };

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

export async function readPublicRecommendations(slug: string, contactId?: string | null) {
  const { db, sql } = createDb();

  try {
    return await getPublicRecommendations(db, slug, contactId);
  } finally {
    await sql.end();
  }
}

export async function readPublicContentDetail(slug: string, section: PublicContentSection, itemSlug: string, baseUrl?: string) {
  const { db, sql } = createDb();

  try {
    return await getPublicContentDetail(db, slug, section, itemSlug, baseUrl);
  } finally {
    await sql.end();
  }
}

export async function readPublicMagazineEdition(slug: string, editionSlug: string) {
  const { db, sql } = createDb();

  try {
    return await getPublicMagazineEdition(db, slug, editionSlug);
  } finally {
    await sql.end();
  }
}

export async function readPublicMagazinePage(slug: string, editionSlug: string, pageNumber: number) {
  const { db, sql } = createDb();

  try {
    return await getPublicMagazinePage(db, slug, editionSlug, pageNumber);
  } finally {
    await sql.end();
  }
}

export async function readPublicBusiness(slug: string, advertiserId: string, baseUrl?: string) {
  const { db, sql } = createDb();

  try {
    return await getPublicBusiness(db, slug, advertiserId, baseUrl);
  } finally {
    await sql.end();
  }
}
