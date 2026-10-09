import { randomUUID } from "node:crypto";
import { contentChannelVariantVersions, contentChannelVariants, contentItems, createDb, fixtureIds } from "@raring2go/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPublicContentDetail, publicSeoRoutesForDb } from ".";

/** Real SQL for public detail pages. `RUN_DB_TESTS=1 pnpm --filter @raring2go/public test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("public detail pages (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const live = { item: randomUUID(), variant: randomUUID(), version: randomUUID(), title: `Detail Test ${tag}` };
  const draft = { item: randomUUID(), title: `Draft Test ${tag}` };

  beforeAll(async () => {
    const base = { contentType: "event", ownerLevel: "territory", territoryId: fixtureIds.territories.suttonColdfield, categories: [], tags: [], provenance: { location: "Test Hall" } };
    await db.insert(contentItems).values([
      { ...base, id: live.item, title: live.title, status: "published", relevantDates: { startDate: "2099-05-01" } },
      { ...base, id: draft.item, title: draft.title, status: "draft", relevantDates: {} }
    ]);
    await db.insert(contentChannelVariants).values({ id: live.variant, contentItemId: live.item, channel: "website", status: "approved", currentVersionId: live.version, territoryId: fixtureIds.territories.suttonColdfield });
    await db.insert(contentChannelVariantVersions).values({ id: live.version, variantId: live.variant, versionNumber: 1, status: "approved", snapshot: { body: "Real body text." } });
  });

  afterAll(async () => {
    await db.delete(contentChannelVariantVersions).where(eq(contentChannelVariantVersions.id, live.version));
    await db.delete(contentChannelVariants).where(eq(contentChannelVariants.id, live.variant));
    await db.delete(contentItems).where(eq(contentItems.id, live.item));
    await db.delete(contentItems).where(eq(contentItems.id, draft.item));
    await sql.end();
  });

  const slugOf = (title: string) => title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  it("serves a published item with its body, and no draft or wrong-territory item", async () => {
    const detail = await getPublicContentDetail(db, "sutton-coldfield", "whats-on", slugOf(live.title));
    expect(detail).toMatchObject({ body: ["Real body text."], indexable: true });
    expect(detail?.structuredData).toMatchObject({ "@type": "Event" });

    expect(await getPublicContentDetail(db, "sutton-coldfield", "whats-on", slugOf(draft.title))).toBeUndefined();
    expect(await getPublicContentDetail(db, "solihull", "whats-on", slugOf(live.title))).toBeUndefined();
  });

  it("lists the published page in the sitemap and not the draft", async () => {
    const paths = (await publicSeoRoutesForDb(db, "https://www.raring2go.example")).map((route) => route.path);
    expect(paths).toContain(`https://www.raring2go.example/areas/sutton-coldfield/whats-on/${slugOf(live.title)}`);
    expect(paths.some((path) => path.includes(slugOf(draft.title)))).toBe(false);
  });
});
