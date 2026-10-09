import { createDb } from "@raring2go/db";
import { defineJobHandler } from "@raring2go/workflows";
import type { JobHandler } from "@raring2go/workflows";
import { runDueJourneyExecutions, scanJourneyTriggers } from "./journey-worker";

export const RUN_JOURNEYS_KIND = "marketing.run_journeys";

/** Cron ticks about every minute; one job per five-minute bucket is plenty and stops a backlog of identical jobs. */
export const runJourneysIdempotencyKey = (now: Date) => `${RUN_JOURNEYS_KIND}:${Math.floor(now.getTime() / 300_000)}`;

/**
 * The journey engine as a durable job: first look for people who should enter trigger-based journeys,
 * then run every step that is due. Visible, retried and dead-lettered like the rest of the job runtime.
 */
export function createRunJourneysHandler(): JobHandler {
  return defineJobHandler({
    kind: RUN_JOURNEYS_KIND,
    maxAttempts: 3,
    handle: async ({ now }) => {
      const { db, sql } = createDb();
      try {
        const scanned = await scanJourneyTriggers(db, now());
        const executed = await runDueJourneyExecutions(db);
        return { ...scanned, ...executed };
      } finally {
        await sql.end();
      }
    }
  });
}
