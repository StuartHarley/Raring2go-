import { randomUUID } from "node:crypto";
import type { AiSourceRef, AiTaskRisk } from "./task";

export type AiApprovalState = "not_required" | "pending" | "approved" | "rejected";
export type AiRunStatus = "succeeded" | "failed";

export type AiRunRecord = {
  id: string;
  taskKey: string;
  purpose: string;
  promptVersion: string;
  providerKey: string;
  modelReference: string;
  status: AiRunStatus;
  risk: AiTaskRisk;
  approvalState: AiApprovalState;
  actorType: "human" | "automation";
  actorUserId: string | null;
  organisationId: string | null;
  territoryId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  sourceRefs: AiSourceRef[];
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMinor: number;
  latencyMs: number | null;
  error: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  appliedAt: Date | null;
  createdAt: Date;
};

export type NewAiRun = Omit<AiRunRecord, "id" | "decidedByUserId" | "decidedAt" | "decisionNote" | "appliedAt" | "createdAt">;

export type AiRunFilter = {
  taskKeys?: string[];
  approvalStates?: AiApprovalState[];
  territoryId?: string;
  subjectType?: string;
  subjectId?: string;
  limit?: number;
};

/** Persistence port; the Drizzle implementation is in repository.ts. */
export type AiRunStore = {
  insert(run: NewAiRun, now: Date): Promise<AiRunRecord>;
  get(id: string): Promise<AiRunRecord | undefined>;
  list(filter: AiRunFilter): Promise<AiRunRecord[]>;
  /** Decides a pending run exactly once. */
  decide(id: string, decision: { state: "approved" | "rejected"; userId: string; note: string | null }, now: Date): Promise<AiRunRecord | undefined>;
  /** Marks an approved/not-required run as applied, exactly once. */
  markApplied(id: string, now: Date): Promise<AiRunRecord | undefined>;
};

export function createInMemoryAiRunStore(): AiRunStore & { runs: Map<string, AiRunRecord> } {
  const runs = new Map<string, AiRunRecord>();

  return {
    runs,
    async insert(run, now) {
      const record: AiRunRecord = { ...run, id: randomUUID(), decidedByUserId: null, decidedAt: null, decisionNote: null, appliedAt: null, createdAt: now };
      runs.set(record.id, record);
      return record;
    },
    async get(id) {
      return runs.get(id);
    },
    async list(filter) {
      return [...runs.values()]
        .filter((run) => !filter.taskKeys || filter.taskKeys.includes(run.taskKey))
        .filter((run) => !filter.approvalStates || filter.approvalStates.includes(run.approvalState))
        .filter((run) => !filter.territoryId || run.territoryId === filter.territoryId)
        .filter((run) => !filter.subjectType || run.subjectType === filter.subjectType)
        .filter((run) => !filter.subjectId || run.subjectId === filter.subjectId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, filter.limit ?? 100);
    },
    async decide(id, decision, now) {
      const existing = runs.get(id);
      if (!existing || existing.approvalState !== "pending") return undefined;
      const next = { ...existing, approvalState: decision.state, decidedByUserId: decision.userId, decidedAt: now, decisionNote: decision.note };
      runs.set(id, next);
      return next;
    },
    async markApplied(id, now) {
      const existing = runs.get(id);
      if (!existing || existing.appliedAt || existing.status !== "succeeded") return undefined;
      if (existing.approvalState !== "approved" && existing.approvalState !== "not_required") return undefined;
      const next = { ...existing, appliedAt: now };
      runs.set(id, next);
      return next;
    }
  };
}
