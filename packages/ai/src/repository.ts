import { aiRuns } from "@raring2go/db";
import type { createDb } from "@raring2go/db";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { AiApprovalState, AiRunRecord, AiRunStore } from "./runs";

export type AiDb = ReturnType<typeof createDb>["db"];

const toRecord = (row: typeof aiRuns.$inferSelect) => row as unknown as AiRunRecord;
const MAX_LIMIT = 500;

export function createDrizzleAiRunStore(db: AiDb): AiRunStore {
  return {
    async insert(run, now) {
      const [row] = await db
        .insert(aiRuns)
        .values({ ...run, sourceRefs: run.sourceRefs as unknown as Array<Record<string, unknown>>, createdAt: now })
        .returning();
      if (!row) throw new Error("AI run was not recorded.");
      return toRecord(row);
    },
    async get(id) {
      const [row] = await db.select().from(aiRuns).where(eq(aiRuns.id, id));
      return row ? toRecord(row) : undefined;
    },
    async list(filter) {
      const conditions = [];
      if (filter.taskKeys && filter.taskKeys.length > 0) conditions.push(inArray(aiRuns.taskKey, filter.taskKeys));
      if (filter.approvalStates && filter.approvalStates.length > 0) conditions.push(inArray(aiRuns.approvalState, filter.approvalStates as AiApprovalState[]));
      if (filter.territoryId) conditions.push(eq(aiRuns.territoryId, filter.territoryId));
      if (filter.subjectType) conditions.push(eq(aiRuns.subjectType, filter.subjectType));
      if (filter.subjectId) conditions.push(eq(aiRuns.subjectId, filter.subjectId));
      const rows = await db
        .select()
        .from(aiRuns)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(aiRuns.createdAt))
        .limit(Math.min(filter.limit ?? 100, MAX_LIMIT));
      return rows.map(toRecord);
    },
    async decide(id, decision, now) {
      const [row] = await db
        .update(aiRuns)
        .set({ approvalState: decision.state, decidedByUserId: decision.userId, decidedAt: now, decisionNote: decision.note })
        .where(and(eq(aiRuns.id, id), eq(aiRuns.approvalState, "pending")))
        .returning();
      return row ? toRecord(row) : undefined;
    },
    async markApplied(id, now) {
      const [row] = await db
        .update(aiRuns)
        .set({ appliedAt: now })
        .where(and(eq(aiRuns.id, id), isNull(aiRuns.appliedAt), eq(aiRuns.status, "succeeded"), or(eq(aiRuns.approvalState, "approved"), eq(aiRuns.approvalState, "not_required"))))
        .returning();
      return row ? toRecord(row) : undefined;
    }
  };
}
