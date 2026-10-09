import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "@raring2go/audit";
import { createDb } from "@raring2go/db";
import { applyDerivedRenewals, deriveRenewalPrompts, loadAdvertisingData, persistAdvertisingChanges, snapshotAdvertisingData } from "@raring2go/advertising";
import { defineJobHandler } from "@raring2go/workflows";
import type { JobHandler } from "@raring2go/workflows";

export const GENERATE_RENEWALS_KIND = "advertising.generate_renewals";

export const generateRenewalsIdempotencyKey = (now: Date) => `${GENERATE_RENEWALS_KIND}:${now.toISOString().slice(0, 10)}`;

/**
 * Daily: finds advertisers due a renewal conversation (see `deriveRenewalPrompts` for the rule) and
 * creates their prompts. One transaction, and a campaign that already has a prompt never gets another,
 * so a retried or doubled run creates nothing new.
 */
export function createGenerateRenewalsHandler(): JobHandler {
  return defineJobHandler({
    kind: GENERATE_RENEWALS_KIND,
    maxAttempts: 3,
    handle: async ({ now }) => {
      const at = now();
      const { db, sql } = createDb();
      try {
        return await db.transaction(async (tx) => {
          const data = await loadAdvertisingData(tx);
          const before = snapshotAdvertisingData(data);
          const created = applyDerivedRenewals(data, deriveRenewalPrompts(data, at.toISOString().slice(0, 10)), randomUUID);
          await persistAdvertisingChanges(tx, before, data);
          for (const prompt of created) {
            await recordAuditEvent(tx, {
              action: "advertiser.renewal.prompt.create",
              actor: { type: "automation", automationId: GENERATE_RENEWALS_KIND },
              entity: { type: "advertiser", id: prompt.advertiserId },
              scope: { territoryId: prompt.territoryId },
              after: { renewalPromptId: prompt.id, dueOn: prompt.dueOn ?? null, derived: true }
            });
          }
          return { created: created.length };
        });
      } finally {
        await sql.end();
      }
    }
  });
}
