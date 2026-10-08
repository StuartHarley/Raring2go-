import { AiNotConfiguredError, AiOutputError, AiRunFailedError } from "@raring2go/ai";
import type { AiRunRecord, AiTask } from "@raring2go/ai";
import { PermissionDeniedError } from "@raring2go/permissions";
import { aiAssistConfigured, AiLimitError, readLatestAiRunForSubject, runAiTaskAsActor } from "./ai-runtime";
import { getPermissionData } from "./permission-source";

export type AssistantActor = { userId: string; organisationId?: string | null; territoryId?: string | null };
export type AssistantSubject = { type: string; id: string };

/** Is a model configured? The deterministic analysis in every panel works either way. */
export const assistantsConfigured = aiAssistConfigured;

/**
 * Run one assistant task for one record. Everything the gateway guarantees applies: the task's permission
 * is checked against the actor's own grants, usage caps are enforced, and a run is recorded with actor,
 * purpose, source references, output and approval state.
 */
export async function runAssistant<Input, Output extends Record<string, unknown>>(actor: AssistantActor, task: AiTask<Input, Output>, input: Input, subject: AssistantSubject) {
  return runAiTaskAsActor(actor, await getPermissionData(), task, { input, subject });
}

/** The newest stored output of a task for a record, typed. Re-reading a run never calls a model. */
export async function latestAssistantOutput<Output extends Record<string, unknown>>(
  actor: AssistantActor,
  task: Pick<AiTask<never, Output>, "key">,
  subject: AssistantSubject
): Promise<{ run: AiRunRecord; output: Output } | undefined> {
  const run = await readLatestAiRunForSubject(actor, { taskKey: task.key, subjectType: subject.type, subjectId: subject.id });
  return run && run.status === "succeeded" ? { run, output: run.output as Output } : undefined;
}

/** Fixed result codes the assistant actions redirect with. */
export type AssistantResultCode = "ai_done" | "ai_not_configured" | "ai_limit" | "ai_failed" | "not_allowed";

export function assistantErrorCode(error: unknown): AssistantResultCode | undefined {
  if (error instanceof PermissionDeniedError) return "not_allowed";
  if (error instanceof AiLimitError) return "ai_limit";
  if (error instanceof AiNotConfiguredError || (error instanceof Error && /not configured for this environment/.test(error.message))) return "ai_not_configured";
  if (error instanceof AiRunFailedError || error instanceof AiOutputError) return "ai_failed";
  return undefined;
}

export const assistantMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  ai_done: { tone: "success", text: "AI commentary prepared. It is a draft to check, not a decision." },
  draft_reviewed: { tone: "success", text: "Draft marked as reviewed. It has not been sent: copy it into your email when you are ready." },
  draft_discarded: { tone: "success", text: "Draft discarded." },
  match_applied: { tone: "success", text: "Payment allocated. It is recorded as coming from a suggested match." },
  match_stale: { tone: "error", text: "That suggestion is no longer valid: the payment or invoice has changed. Refresh and look again." },
  ai_not_configured: { tone: "error", text: "AI commentary is not switched on for this environment. The analysis above does not need it." },
  ai_limit: { tone: "error", text: "The AI usage limit has been reached for now. The analysis above is unaffected; try again later." },
  ai_failed: { tone: "error", text: "The AI service could not produce a usable result. The analysis above is unaffected; try again." },
  not_allowed: { tone: "error", text: "You do not have permission to use this assistant here." }
};
