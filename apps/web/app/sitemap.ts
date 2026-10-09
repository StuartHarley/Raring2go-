import type { MetadataRoute } from "next";
import { createDb } from "@raring2go/db";
import { publicSeoRoutesForDb } from "@raring2go/public";

// Territories come from the database, so the sitemap must not be frozen at build time.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { db, sql } = createDb();

  try {
    return (await publicSeoRoutesForDb(db, siteUrl())).map((route) => ({
      url: route.path,
      changeFrequency: route.changeFrequency,
      priority: route.priority
    }));
  } finally {
    await sql.end();
  }
}

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}
