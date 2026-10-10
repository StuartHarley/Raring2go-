import { createDb, inventorySlots } from "@raring2go/db";
import { createEditionInventorySlots, loadAdvertisingData, retireInventorySlot } from "@raring2go/advertising";
import { loadPublishingData } from "@raring2go/publishing";
import type { PublishingActorContext } from "@raring2go/publishing";
import { and, eq, isNull } from "drizzle-orm";
import { mutate } from "./advertising-mutations";
import { readTerritoryEdition } from "./publishing-runtime";

/** What the flatplan's advertiser-slot panel shows. Scope is proven by the edition read. */
export async function readEditionInventory(context: PublishingActorContext, territoryEditionId: string) {
  const { row, pages, content } = await readTerritoryEdition(context, territoryEditionId);
  const { db, sql } = createDb();
  try {
    const data = await loadAdvertisingData(db);
    const products = data.products
      .filter((product) => !product.deletedAt && product.status === "active" && product.requiresInventory && product.channel === "magazine" && typeof product.metadata.inventoryClass === "string")
      .map((product) => ({ id: product.id, name: product.name, inventoryClass: String(product.metadata.inventoryClass) }));
    const slots = data.inventorySlots.filter((slot) => slot.territoryEditionId === territoryEditionId && !slot.deletedAt);
    const hasContent = (pageContentId: string | null | undefined) => Boolean(pageContentId && content.some((entry) => entry.id === pageContentId));
    return {
      edition: row.territoryEdition,
      products,
      slots: slots.map((slot) => ({
        id: slot.id,
        status: slot.status,
        pageNumber: pages.find((page) => page.id === slot.editionPageId)?.pageNumber ?? null,
        productName: data.products.find((product) => product.id === slot.productId)?.name ?? "Advertisement",
        inventoryClass: slot.inventoryClass
      })).sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0)),
      pages: pages.map((page) => {
        const reason = page.locked ? "locked" : hasContent(page.assignedContentId) ? "has editorial content" : page.ownerType === "hq" && context.territoryId ? "HQ page" : null;
        return { id: page.id, pageNumber: page.pageNumber, eligible: reason === null, reason, sold: slots.some((slot) => slot.editionPageId === page.id) };
      })
    };
  } finally {
    await sql.end();
  }
}

export async function createSlotsAsActor(context: PublishingActorContext, territoryEditionId: string, productId: string, pageIds: string[]) {
  return mutate(async (tx, data, audit, permissions) => {
    const publishing = await loadPublishingData(tx);
    const edition = publishing.territoryEditions.find((candidate) => candidate.id === territoryEditionId && !candidate.deletedAt);
    if (!edition) throw new Error("Edition was not found.");
    const target = {
      id: edition.id,
      territoryId: edition.territoryId,
      status: edition.status,
      pages: publishing.editionPages
        .filter((page) => page.territoryEditionId === edition.id && !page.deletedAt)
        .map((page) => ({ id: page.id, pageNumber: page.pageNumber, locked: page.locked, ownerType: page.ownerType, hasContent: Boolean(page.assignedContentId) }))
    };
    return createEditionInventorySlots({ userId: context.userId, organisationId: context.organisationId, territoryId: context.territoryId }, permissions, audit, data, { edition: target, productId, pageIds });
  });
}

export const retireSlotAsActor = (context: PublishingActorContext, slotId: string) =>
  mutate(async (_tx, data, audit, permissions) => retireInventorySlot({ userId: context.userId, organisationId: context.organisationId, territoryId: context.territoryId }, permissions, audit, data, slotId));

/** Editorial content cannot go on a page that is on sale: the slot has to be taken off sale first. */
export async function assertPageNotOnSale(pageId: string) {
  const { db, sql } = createDb();
  try {
    const live = await db.select({ id: inventorySlots.id }).from(inventorySlots).where(and(eq(inventorySlots.editionPageId, pageId), isNull(inventorySlots.deletedAt)));
    if (live.length > 0) throw new Error("This page is on sale to advertisers. Take its slot off sale before adding editorial content.");
  } finally {
    await sql.end();
  }
}
