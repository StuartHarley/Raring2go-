import { createHash, randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { recordAuditEvent } from "@raring2go/audit";
import { createDb } from "@raring2go/db";
import { completeFileUpload, getFileReferenceRecord, insertFileReferenceRecord } from "@raring2go/files";
import {
  createHttpRenderProvider,
  generateDigitalOutput,
  generatePrintOutput,
  loadPublishingData,
  persistEditionChanges,
  prepareEditionOutput,
  printMarginMm,
  renderEditionHtml,
  saddleStitchSheets,
  RenderProviderError,
  sha256Hex,
  snapshotPublishingData,
  verifyRenderResult
} from "@raring2go/publishing";
import type { PublishingActorContext, RenderProvider, RenderReport, RenderRequest } from "@raring2go/publishing";
import { assertFileIsDownloadable, createScannerProviderFromEnv, createStorageProviderFromEnv } from "@raring2go/storage";
import { createDrizzleJobStore, defineJobHandler, enqueueJob, PermanentJobError, RetryableJobError } from "@raring2go/workflows";
import type { JobHandler, WorkflowsDb } from "@raring2go/workflows";
import { getPermissionData } from "./permission-source";
import { resolveImageUrlsForRender } from "./studio-images";
import { readTerritoryEdition } from "./publishing-runtime";

export const GENERATE_OUTPUT_KIND = "publishing.generate_output";

export type GenerateOutputPayload = { territoryEditionId: string; kind: "print" | "digital"; actor: PublishingActorContext };

export function editionAuditFor(db: Parameters<typeof recordAuditEvent>[0]) {
  return {
    record: async (event: { action: string; actorUserId?: string | null; entityType: string; entityId?: string | null; organisationId?: string | null; territoryId?: string | null; payload?: Record<string, unknown> }) =>
      void (await recordAuditEvent(db, {
        action: event.action,
        actor: event.actorUserId ? { type: "human", userId: event.actorUserId } : { type: "automation", automationId: "edition.factory" },
        entity: { type: event.entityType, id: event.entityId ?? undefined },
        scope: { organisationId: event.organisationId ?? undefined, territoryId: event.territoryId ?? undefined },
        after: event.payload
      }))
  };
}

/**
 * Stand-in used only outside production when no render service is configured. It draws each sheet's text on a
 * correctly sized page so the whole flow can be exercised, and says plainly that it is not press-ready.
 */
export function createDevelopmentRenderProvider(): RenderProvider {
  return {
    key: "development",
    async render(request: RenderRequest) {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const sheets = request.html.split(/<section class="sheet"/).slice(1);
      for (const sheet of sheets) {
        const page = doc.addPage([(request.sheetWidthMm / 25.4) * 72, (request.sheetHeightMm / 25.4) * 72]);
        const text = sheet.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim().replace(/[^\x20-\x7e]/g, "?");
        let y = page.getHeight() - 60;
        for (let i = 0; i < text.length && y > 40; i += 90) {
          page.drawText(text.slice(i, i + 90), { x: 40, y, size: 10, font });
          y -= 14;
        }
      }
      const pdf = new Uint8Array(await doc.save());
      const report: RenderReport = {
        provider: "development",
        pressReady: false,
        pdfx: "none",
        colourSpace: "rgb",
        outputIntent: null,
        fontsEmbedded: true,
        pageCount: sheets.length,
        bleedMm: request.bleedMm,
        boxes: false,
        warnings: ["Development stand-in: layout is not rendered and the file is not press-ready."]
      };
      return { pdf, sha256: sha256Hex(pdf), report };
    }
  };
}

/** Production fails closed: with no render service configured nothing is produced, rather than a stand-in being mistaken for the real thing. */
export function resolveRenderProvider(env: NodeJS.ProcessEnv = process.env): RenderProvider | null {
  if (env.RENDER_SERVICE_URL && env.RENDER_API_KEY) return createHttpRenderProvider({ baseUrl: env.RENDER_SERVICE_URL, secret: env.RENDER_API_KEY });
  if (env.NODE_ENV !== "production") return createDevelopmentRenderProvider();
  return null;
}

/** Same inputs, same key: re-queueing an unchanged edition returns the output it already made. */
export function outputIdempotencyKey(kind: string, editionId: string, html: string) {
  return `edition-output:${kind}:${editionId}:${createHash("sha256").update(html).digest("hex").slice(0, 32)}`;
}

type Deps = {
  provider?: RenderProvider | null;
  db?: ReturnType<typeof createDb>;
  images?: { storage?: ReturnType<typeof createStorageProviderFromEnv> };
  files?: { storage: ReturnType<typeof createStorageProviderFromEnv>; scanner: ReturnType<typeof createScannerProviderFromEnv>; fetch?: typeof fetch };
};

/**
 * Renders and records one output in three steps, so a slow render never holds a transaction open:
 *  1. check the actor, edition, readiness and layout (nothing is rendered if any fails);
 *  2. render, verify, and store the file (scanned like any upload);
 *  3. record the output and its audit event in one transaction. A retry after a crash finds the same
 *     idempotency key and returns the output already recorded.
 */
export async function generateEditionOutput(payload: GenerateOutputPayload, deps: Deps = {}) {
  const provider = deps.provider === undefined ? resolveRenderProvider() : deps.provider;
  if (!provider) throw new PermanentJobError("No render service is configured (RENDER_SERVICE_URL and RENDER_API_KEY).", "render_not_configured");
  const permissions = await getPermissionData();
  const owned = deps.db ? null : createDb();
  const { db } = deps.db ?? owned!;
  try {
    const prepared = await (async () => {
      const data = await loadPublishingData(db);
      try {
        return prepareEditionOutput(payload.actor, permissions, data, payload.territoryEditionId, payload.kind);
      } catch (error) {
        throw new PermanentJobError(error instanceof Error ? error.message : "The edition cannot be output.", "not_ready");
      }
    })();
    const { edition, model } = prepared;
    // The key is made from the HTML with stable placeholders for uploaded images, so a changed picture (a new file id) makes
    // a new version but a refreshed download link does not.
    const html = renderEditionHtml(model, payload.kind);
    const key = outputIdempotencyKey(payload.kind, edition.id, html);

    const existing = (await loadPublishingData(db)).publicationOutputs.find((output) => output.idempotencyKey === key && !output.deletedAt);
    if (existing) return { outputId: existing.id, reused: true };

    const fileIds = model.pages.flatMap((page) => page.zones.map((zone) => zone.image?.fileId).filter((id): id is string => Boolean(id)));
    let renderHtml = html;
    if (fileIds.length > 0) {
      try {
        renderHtml = renderEditionHtml(model, payload.kind, { imageUrls: await resolveImageUrlsForRender(edition.territoryId, fileIds, deps.images) });
      } catch (error) {
        throw new PermanentJobError(error instanceof Error ? error.message : "A placed image could not be found.", "image_unavailable");
      }
    }

    const bleedMm = payload.kind === "print" ? model.geometry.bleed : 0;
    const marginMm = payload.kind === "print" ? printMarginMm(model.geometry.bleed) : 0;
    const request: RenderRequest = {
      kind: payload.kind,
      html: renderHtml,
      sheetWidthMm: model.geometry.trimWidth + marginMm * 2,
      sheetHeightMm: model.geometry.trimHeight + marginMm * 2,
      bleedMm,
      pageCount: model.pages.length,
      idempotencyKey: key,
      ...(payload.kind === "print"
        ? { trimWidthMm: model.geometry.trimWidth, trimHeightMm: model.geometry.trimHeight, marginMm, impose: { sheets: saddleStitchSheets(model.pages.length) } }
        : {})
    };
    let result;
    try {
      result = await provider.render(request);
    } catch (error) {
      if (error instanceof RenderProviderError) {
        if (!error.retryable) throw new PermanentJobError(error.message, `render_${error.code}`);
        throw new RetryableJobError(error.message, { code: `render_${error.code}` });
      }
      throw error;
    }
    // A development stand-in is never press-ready, so only the real provider's print files are held to the print checks.
    if (provider.key !== "development") {
      const problems = verifyRenderResult(request, result);
      if (problems.length > 0) throw new PermanentJobError(problems.join(" "), "render_unverified");
    } else if (result.report.pageCount !== request.pageCount) {
      throw new PermanentJobError("The stand-in produced the wrong number of pages.", "render_unverified");
    }

    const storeFile = async (bytes: Uint8Array, label: string) => {
      const fileId = randomUUID();
      const reference = await completeFileUpload(
        payload.actor,
        permissions,
        deps.files ?? { storage: createStorageProviderFromEnv(), scanner: createScannerProviderFromEnv() },
        {
          id: fileId,
          storageKey: `editions/${edition.territoryId}/${edition.id}/${label}-${fileId}.pdf`,
          fileName: `${edition.title.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 60)}-${label}.pdf`,
          contentType: "application/pdf",
          bytes,
          accessScope: payload.actor.territoryId ? "territory" : "organisation"
        }
      );
      await insertFileReferenceRecord(db, reference);
      return reference;
    };
    const reference = await storeFile(result.pdf, payload.kind);
    const imposedReference = result.imposed ? await storeFile(result.imposed.pdf, "imposed") : null;

    const artifact = {
      fileId: reference.id,
      sha256: result.sha256,
      bytes: result.pdf.byteLength,
      pageCount: result.report.pageCount,
      provider: result.report.provider,
      pressReady: result.report.pressReady,
      pdfx: result.report.pdfx,
      colourSpace: result.report.colourSpace,
      outputIntent: result.report.outputIntent,
      bleedMm: result.report.bleedMm,
      boxes: result.report.boxes,
      warnings: result.report.warnings,
      ...(payload.kind === "print" ? { proofOnly: !result.report.pressReady } : {}),
      ...(result.imposed && imposedReference
        ? {
            imposed: {
              fileId: imposedReference.id,
              sha256: result.imposed.sha256,
              bytes: result.imposed.pdf.byteLength,
              sheets: result.imposed.report.pageCount / 2,
              pressReady: result.imposed.report.pressReady,
              pdfx: result.imposed.report.pdfx,
              warnings: result.imposed.report.warnings
            }
          }
        : {})
    };

    return await db.transaction(async (tx) => {
      const data = await loadPublishingData(tx);
      const before = snapshotPublishingData(data);
      const input = { idempotencyKey: key, artifact };
      const output =
        payload.kind === "print"
          ? await generatePrintOutput(payload.actor, permissions, editionAuditFor(tx), data, edition.id, input)
          : await generateDigitalOutput(payload.actor, permissions, editionAuditFor(tx), data, edition.id, input);
      await persistEditionChanges(tx, before, data);
      return { outputId: output.id, reused: false };
    });
  } finally {
    if (owned) await owned.sql.end();
  }
}

export function createGenerateOutputHandler(): JobHandler {
  return defineJobHandler({
    kind: GENERATE_OUTPUT_KIND,
    maxAttempts: 3,
    handle: async ({ job }) => {
      const payload = job.payload as unknown as GenerateOutputPayload;
      if (!payload?.territoryEditionId || (payload.kind !== "print" && payload.kind !== "digital") || !payload.actor?.userId) {
        throw new PermanentJobError("The output job payload is incomplete.", "bad_payload");
      }
      return generateEditionOutput(payload);
    }
  });
}

/**
 * Queues an output for the worker. The actor is checked now (so a refused request fails in the page, not later in a
 * queue) and again when the job runs. One job per edition and kind at a time.
 */
export async function queueEditionOutput(payload: GenerateOutputPayload) {
  const permissions = await getPermissionData();
  const { db, sql } = createDb();
  try {
    const data = await loadPublishingData(db);
    const { edition } = prepareEditionOutput(payload.actor, permissions, data, payload.territoryEditionId, payload.kind);
    const store = createDrizzleJobStore(db as unknown as WorkflowsDb);
    const bucket = Math.floor(Date.now() / 60_000);
    return await enqueueJob(store, { record: (input) => recordAuditEvent(db, input) }, {
      kind: GENERATE_OUTPUT_KIND,
      idempotencyKey: `${GENERATE_OUTPUT_KIND}:${edition.id}:${payload.kind}:${bucket}`,
      territoryId: edition.territoryId,
      organisationId: payload.actor.organisationId ?? null,
      subjectType: "territory_edition",
      subjectId: edition.id,
      createdByUserId: payload.actor.userId,
      payload: payload as unknown as Record<string, unknown>
    });
  } finally {
    await sql.end();
  }
}

/**
 * A short-lived download address for an output's PDF. Access is decided by the edition (the actor must be able to see
 * it, which proves territory scope) and the file must be the one that edition's output recorded and be scanned clean.
 */
export async function resolveOutputDownload(actor: PublishingActorContext, territoryEditionId: string, outputId: string, which: "main" | "imposed" = "main") {
  const { outputs } = await readTerritoryEdition(actor, territoryEditionId);
  const output = outputs.find((candidate) => candidate.id === outputId);
  const source = which === "imposed" ? (output?.artifact.imposed as { fileId?: unknown } | undefined) : output?.artifact;
  const fileId = source && typeof source.fileId === "string" ? source.fileId : null;
  if (!output || !fileId) throw new Error("That output has no file to download.");
  const { db, sql } = createDb();
  try {
    const reference = await getFileReferenceRecord(db, fileId);
    if (!reference || reference.deletedAt) throw new Error("That output has no file to download.");
    assertFileIsDownloadable(reference);
    const intent = await createStorageProviderFromEnv().createDownloadIntent(reference, { disposition: "attachment" });
    return { url: intent.downloadUrl, fileName: reference.fileName };
  } finally {
    await sql.end();
  }
}

export type OutputReadiness = Record<"print" | "digital", { allowed: boolean; blocker: string | null }>;

/** Why each output can or cannot be generated right now, from the same check the job runs. The messages are the domain's own, never user text. */
export async function readOutputReadiness(actor: PublishingActorContext, territoryEditionId: string): Promise<OutputReadiness> {
  const permissions = await getPermissionData();
  const { db, sql } = createDb();
  try {
    const data = await loadPublishingData(db);
    const check = (kind: "print" | "digital") => {
      try {
        prepareEditionOutput(actor, permissions, data, territoryEditionId, kind);
        return { allowed: true, blocker: null };
      } catch (error) {
        return { allowed: false, blocker: error instanceof Error ? error.message : "Not available." };
      }
    };
    return { print: check("print"), digital: check("digital") };
  } finally {
    await sql.end();
  }
}
