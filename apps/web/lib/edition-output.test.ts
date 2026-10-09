import { randomUUID } from "node:crypto";
import {
  auditEvents, createDb, preflightResults, editionPages, fileReferences, fixtureIds, magazineTemplates, magazineTemplateVersions, masterEditions, publicationOutputs, seasons, territoryEditions
} from "@raring2go/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateEditionOutput, createDevelopmentRenderProvider, outputIdempotencyKey, resolveRenderProvider } from "./edition-output";

describe("render provider selection", () => {
  it("fails closed in production and uses the stand-in elsewhere", () => {
    expect(resolveRenderProvider({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBeNull();
    expect(resolveRenderProvider({ NODE_ENV: "development" } as NodeJS.ProcessEnv)?.key).toBe("development");
    expect(resolveRenderProvider({ NODE_ENV: "production", RENDER_SERVICE_URL: "https://r.example", RENDER_API_KEY: "k" } as NodeJS.ProcessEnv)?.key).toBe("chromium-ghostscript");
  });
  it("keys on content", () => {
    expect(outputIdempotencyKey("print", "e", "<a>")).toBe(outputIdempotencyKey("print", "e", "<a>"));
    expect(outputIdempotencyKey("print", "e", "<a>")).not.toBe(outputIdempotencyKey("print", "e", "<b>"));
  });
});

/** Real database: an approved edition renders to a stored, recorded digital output exactly once. `RUN_DB_TESTS=1` */
describe.skipIf(!process.env.RUN_DB_TESTS)("edition output generation (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const actor = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq, territoryId: null };
  const franchisee = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const ids = { season: randomUUID(), master: randomUUID(), edition: randomUUID(), template: randomUUID(), version: randomUUID(), page1: randomUUID(), page2: randomUUID() };
  const files = {
    storage: { key: "test", createUploadIntent: async (reference: never) => ({ reference, uploadUrl: "https://storage.test/put", headers: {}, expiresAt: new Date().toISOString() }), createDownloadIntent: async () => { throw new Error("unused"); } },
    scanner: { key: "test", scan: async (reference: { id: string }) => ({ fileId: reference.id, status: "clean" as const, providerKey: "test", scannedAt: new Date().toISOString() }) },
    fetch: (async () => new Response("", { status: 200 })) as typeof fetch
  };

  beforeAll(async () => {
    await db.insert(seasons).values({ id: ids.season, key: `eo-${tag}`, name: `EO ${tag}`, year: 2099, season: "autumn", accent: "#aa3300" });
    await db.insert(masterEditions).values({ id: ids.master, seasonId: ids.season, organisationId: fixtureIds.organisations.hq, title: `Master ${tag}`, pageCount: 2 });
    await db.insert(territoryEditions).values({
      id: ids.edition, masterEditionId: ids.master, seasonId: ids.season, territoryId: fixtureIds.territories.suttonColdfield, franchiseOrganisationId: fixtureIds.organisations.franchise,
      title: `Edition ${tag}`, status: "approved", pageCount: 2, generatedFromMasterVersion: 1
    });
    await db.insert(magazineTemplates).values({ id: ids.template, key: `eo-${tag}`, name: "EO", category: "article", status: "approved" });
    await db.insert(magazineTemplateVersions).values({
      id: ids.version, templateId: ids.template, version: 1, status: "published", pageDimensions: {}, bleed: { top: 3, right: 3, bottom: 3, left: 3 }, trim: { width: 210, height: 297 }, margins: { top: 12, right: 12, bottom: 14, left: 12 },
      grid: {}, lockedElements: [{ id: "x" }], editableZones: [], imageZones: [], copyZones: [{ id: "body" }], headlineZones: [{ id: "head" }], advertiserZones: [], footerFurniture: {}, printRules: {}, digitalEnhancements: {}
    });
    await db.insert(editionPages).values([1, 2].map((n) => ({
      id: n === 1 ? ids.page1 : ids.page2, territoryEditionId: ids.edition, pageNumber: n, spreadNumber: Math.ceil(n / 2), side: n === 1 ? "single" : "left", status: "approved",
      templateVersionId: ids.version, readiness: "ready", issues: []
    })));
  });

  afterAll(async () => {
    const outputs = await db.select({ id: publicationOutputs.id, artifact: publicationOutputs.artifact }).from(publicationOutputs).where(eq(publicationOutputs.territoryEditionId, ids.edition));
    const fileIds = outputs.map((o) => String(o.artifact.fileId)).filter(Boolean);
    const { withFinanceGuardsDisabled } = await import("./finance-test-support");
    await withFinanceGuardsDisabled(db, async () => {
      await db.delete(auditEvents).where(inArray(auditEvents.entityId, outputs.map((o) => o.id)));
    });
    await db.delete(publicationOutputs).where(eq(publicationOutputs.territoryEditionId, ids.edition));
    await db.delete(preflightResults).where(eq(preflightResults.territoryEditionId, ids.edition));
    if (fileIds.length) await db.delete(fileReferences).where(inArray(fileReferences.id, fileIds));
    await db.delete(editionPages).where(eq(editionPages.territoryEditionId, ids.edition));
    await db.delete(territoryEditions).where(eq(territoryEditions.id, ids.edition));
    await db.delete(masterEditions).where(eq(masterEditions.id, ids.master));
    await db.delete(magazineTemplateVersions).where(eq(magazineTemplateVersions.id, ids.version));
    await db.delete(magazineTemplates).where(eq(magazineTemplates.id, ids.template));
    await db.delete(seasons).where(eq(seasons.id, ids.season));
    await sql.end();
  });

  it("renders, stores and records a digital output once, and an identical request reuses it", async () => {
    const deps = { provider: createDevelopmentRenderProvider(), files: files as never };
    const first = await generateEditionOutput({ territoryEditionId: ids.edition, kind: "digital", actor }, deps);
    expect(first.reused).toBe(false);
    const again = await generateEditionOutput({ territoryEditionId: ids.edition, kind: "digital", actor }, deps);
    expect(again).toEqual({ outputId: first.outputId, reused: true });

    const rows = await db.select().from(publicationOutputs).where(eq(publicationOutputs.territoryEditionId, ids.edition));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outputType: "digital", status: "generated", version: 1 });
    expect(rows[0]!.artifact).toMatchObject({ pageCount: 2, pressReady: false, provider: "development" });
    const [edition] = await db.select().from(territoryEditions).where(eq(territoryEditions.id, ids.edition));
    expect(edition!.digitalStatus).toBe("generated");
    const stored = await db.select().from(fileReferences).where(eq(fileReferences.id, String(rows[0]!.artifact.fileId)));
    expect(stored).toHaveLength(1);
  });

  it("records a press-ready print file from a verified provider, and marks a stand-in's print file as proof only", async () => {
    await db.insert(preflightResults).values([ids.page1, ids.page2].map((entityId) => ({ entityType: "edition_page", entityId, territoryEditionId: ids.edition, status: "passed" })));
    const press = {
      key: "chromium-ghostscript",
      render: async (request: { pageCount: number; bleedMm: number }) => {
        const pdf = new TextEncoder().encode("%PDF-1.3 press");
        const { sha256Hex } = await import("@raring2go/publishing");
        return { pdf, sha256: sha256Hex(pdf), report: { provider: "chromium-ghostscript", pressReady: true, pdfx: "PDF/X-1a:2003" as const, colourSpace: "cmyk" as const, outputIntent: "FOGRA39", fontsEmbedded: true, pageCount: request.pageCount, bleedMm: request.bleedMm, warnings: [] } };
      }
    };
    const printed = await generateEditionOutput({ territoryEditionId: ids.edition, kind: "print", actor }, { provider: press, files: files as never });
    const [row] = await db.select().from(publicationOutputs).where(eq(publicationOutputs.id, printed.outputId));
    expect(row!.artifact).toMatchObject({ pressReady: true, pdfx: "PDF/X-1a:2003", colourSpace: "cmyk", proofOnly: false, bleedMm: 3 });

    const bad = { ...press, render: async (request: { pageCount: number; bleedMm: number }) => ({ ...(await press.render(request)), report: { provider: "x", pressReady: false, pdfx: "none" as const, colourSpace: "rgb" as const, outputIntent: null, fontsEmbedded: true, pageCount: request.pageCount, bleedMm: request.bleedMm, warnings: [] } }) };
    await db.update(publicationOutputs).set({ deletedAt: new Date() }).where(eq(publicationOutputs.id, printed.outputId));
    await expect(generateEditionOutput({ territoryEditionId: ids.edition, kind: "print", actor }, { provider: bad, files: files as never })).rejects.toThrow(/not PDF\/X/);
  });

  it("refuses an actor without the grant", async () => {
    await expect(generateEditionOutput({ territoryEditionId: ids.edition, kind: "digital", actor: franchisee }, { provider: createDevelopmentRenderProvider(), files: files as never })).rejects.toThrow(/permission/);
  });
});
