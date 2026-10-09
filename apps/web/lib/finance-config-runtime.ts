import { randomUUID } from "node:crypto";
import { advertiserProviderSyncReferences, createDb } from "@raring2go/db";
import { ACCOUNTING_PROVIDER_TYPE, loadAdvertisingData, setTaxRate } from "@raring2go/advertising";
import type { AdvertisingActorContext } from "@raring2go/advertising";
import { evaluatePermission } from "@raring2go/permissions";
import { and, eq } from "drizzle-orm";
import { mutate } from "./advertising-mutations";
import { getPermissionData } from "./permission-source";

/**
 * Finance configuration: the tax rates invoices are priced with, and the state of the accounting hand-off.
 * Both need `advertiser.tax_rate.manage`, which is a network permission: a rate applies to every territory.
 */
async function requireTaxAdmin(context: AdvertisingActorContext) {
  const permissions = await getPermissionData();
  const decision = evaluatePermission({ userId: context.userId, module: "advertiser.tax_rate", action: "manage", context: { organisationId: context.organisationId ?? undefined, territoryId: context.territoryId ?? undefined } }, permissions);
  if (!decision.allowed) throw new Error("Not allowed to configure tax.");
}

export async function readFinanceConfig(context: AdvertisingActorContext) {
  await requireTaxAdmin(context);
  const { db, sql } = createDb();
  try {
    const data = await loadAdvertisingData(db);
    const references = await db.select().from(advertiserProviderSyncReferences).where(and(eq(advertiserProviderSyncReferences.providerType, ACCOUNTING_PROVIDER_TYPE)));
    const counts = { pending: 0, synced: 0, failed: 0 };
    for (const reference of references) counts[(reference.status === "synced" ? "synced" : reference.status === "failed" ? "failed" : "pending")] += 1;
    const attention = references
      .filter((reference) => reference.status !== "synced")
      .map((reference) => ({ id: reference.id, entityType: reference.entityType, status: reference.status, attempts: Number((reference.metadata as { attempts?: number }).attempts ?? 0), lastError: (reference.metadata as { lastError?: string }).lastError ?? null, waitingFor: (reference.metadata as { waitingFor?: string }).waitingFor ?? null }));
    const rates = [...data.taxRates].sort((left, right) => left.code.localeCompare(right.code) || right.effectiveFrom.localeCompare(left.effectiveFrom));
    return { rates, counts, attention };
  } finally {
    await sql.end();
  }
}

export async function setTaxRateRecord(context: AdvertisingActorContext, input: { code: string; description: string; rateBps: number; effectiveFrom: string }) {
  return mutate((_tx, data, audit, permissions) => setTaxRate(context, permissions, audit, data, { id: randomUUID(), ...input }));
}

/** Puts a failed document back in the queue so a person can make the accounting system try again. */
export async function retryAccountingSync(context: AdvertisingActorContext, referenceId: string) {
  await requireTaxAdmin(context);
  const { db, sql } = createDb();
  try {
    const [reference] = await db.select().from(advertiserProviderSyncReferences).where(eq(advertiserProviderSyncReferences.id, referenceId));
    if (!reference || reference.providerType !== ACCOUNTING_PROVIDER_TYPE) throw new Error("Accounting sync reference was not found.");
    if (reference.status === "synced") return { alreadyDone: true };
    await db.update(advertiserProviderSyncReferences).set({ status: "pending", metadata: { attempts: 0 } }).where(eq(advertiserProviderSyncReferences.id, referenceId));
    return { alreadyDone: false };
  } finally {
    await sql.end();
  }
}
