import {
  defaultPublicTerritorySlug,
  getPublicHomepage,
  territoryFromSlug
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
