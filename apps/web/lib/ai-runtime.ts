import { auditActions, recordAuditEvent } from "@raring2go/audit";
import { aiRunCapabilities, createAiGatewayFromEnv, createAiProviderFromEnv, createExternalWorkflowsFromEnv, runAiTask, createDrizzleAiRunStore, decideAiRun, estimateCostMinor as estimateCost, getAiRunForActor, listAiRunsForActor } from "@raring2go/ai";
import type { AiActorContext, AiApprovalState, AiGateway, AiRunRecord, AiSuggestionResult, AiTask, AiUsage, CampaignDraft } from "@raring2go/ai";
import { createDevelopmentMemoryRateLimiter } from "@raring2go/auth";
import type { RateLimiter } from "@raring2go/auth";
import { aiUsageEvents, createDb, fixtureIds } from "@raring2go/db";
import { evaluatePermission, requirePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import { marketingCapabilities } from "@raring2go/marketing";
import type { MarketingActorContext } from "@raring2go/marketing";
import { boundForStorage } from "@raring2go/ai";
import { sql } from "drizzle-orm";
import { marketingPermissionData } from "./marketing-runtime";

const rateLimiterKey = Symbol.for("raring2go.ai-assist-rate-limiter");
const globalRateLimiter = globalThis as typeof globalThis & {
  [rateLimiterKey]?: RateLimiter;
};

function getAiAssistRateLimiter(): RateLimiter {
  if (!globalRateLimiter[rateLimiterKey]) {
    globalRateLimiter[rateLimiterKey] = createDevelopmentMemoryRateLimiter({
      limit: Number(process.env.AI_ASSIST_RATE_LIMIT ?? 20),
      windowMs: Number(process.env.AI_ASSIST_RATE_LIMIT_WINDOW_MS ?? 60 * 60 * 1000)
    });
  }

  return globalRateLimiter[rateLimiterKey];
}

async function enforceAiAssistRateLimit(context: MarketingActorContext) {
  const key = context.territoryId ?? context.userId;
  const decision = await getAiAssistRateLimiter().check(key);

  if (!decision.allowed) {
    throw new Error(`AI assist limit reached for this territory. Try again after ${decision.resetAt.toLocaleTimeString()}.`);
  }
}

function requireAiAssistPermission(context: MarketingActorContext) {
  const capability = marketingCapabilities.emailAiAssist;
  requirePermission(
    {
      userId: context.userId,
      module: capability.module,
      action: capability.action,
      context: {
        organisationId: context.organisationId ?? undefined,
        territoryId: context.territoryId ?? undefined
      }
    },
    marketingPermissionData
  );
}

/** Non-throwing check, for deciding whether to show the AI-assist affordances at all. */
export function hasAiAssistCapability(context: MarketingActorContext): boolean {
  const capability = marketingCapabilities.emailAiAssist;
  return evaluatePermission(
    {
      userId: context.userId,
      module: capability.module,
      action: capability.action,
      context: {
        organisationId: context.organisationId ?? undefined,
        territoryId: context.territoryId ?? undefined
      }
    },
    marketingPermissionData
  ).allowed;
}

const DEFAULT_AI_SPEND_CAP_NETWORK_MINOR = 5000; // $50.00/month
const DEFAULT_AI_SPEND_CAP_TERRITORY_MINOR = 1000; // $10.00/month

/** Pricing lives in @raring2go/ai; re-exported here for the existing direct tests. */
export const estimateCostMinor = estimateCost;

async function recordAiUsageEvent(
  context: MarketingActorContext,
  input: { feature: string; providerKey: string; modelReference: string; usage: AiUsage }
) {
  if (!context.organisationId) {
    return;
  }

  const { db, sql: closeSql } = createDb();

  try {
    await db.insert(aiUsageEvents).values({
      organisationId: context.organisationId,
      territoryId: context.territoryId ?? null,
      actorUserId: context.userId,
      feature: input.feature,
      providerKey: input.providerKey,
      modelReference: input.modelReference,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      estimatedCostMinor: estimateCostMinor(input.modelReference, input.usage)
    });
  } finally {
    await closeSql.end();
  }
}

/** Exported for reuse by a future read-only usage display, and for direct testing. */
export async function sumAiSpendForPeriod(context: MarketingActorContext, input: { since: Date }): Promise<number> {
  if (!context.organisationId) {
    return 0;
  }

  const { db, sql: closeSql } = createDb();

  try {
    const scopeCondition = context.territoryId
      ? sql`territory_id = ${context.territoryId}`
      : sql`organisation_id = ${context.organisationId} AND territory_id IS NULL`;
    const rows = await db.execute(sql`
      SELECT COALESCE(SUM(estimated_cost_minor), 0) AS total
      FROM ai_usage_events
      WHERE ${scopeCondition} AND created_at >= ${input.since.toISOString()}
    `);
    const row = rows[0] as { total: string | number } | undefined;
    return Number(row?.total ?? 0);
  } finally {
    await closeSql.end();
  }
}

function startOfCurrentMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * A persisted, spend-based cap - distinct from enforceAiAssistRateLimit's
 * in-memory call-count limiter above. The rate limiter guards against a
 * runaway burst cheaply (no DB round-trip); this guards actual monthly
 * budget and survives process restarts. Both checks run on every call.
 */
export async function enforceAiSpendCap(context: MarketingActorContext) {
  const capMinor = context.territoryId
    ? Number(process.env.AI_SPEND_CAP_TERRITORY_MINOR ?? DEFAULT_AI_SPEND_CAP_TERRITORY_MINOR)
    : Number(process.env.AI_SPEND_CAP_NETWORK_MINOR ?? DEFAULT_AI_SPEND_CAP_NETWORK_MINOR);
  const spentMinor = await sumAiSpendForPeriod(context, { since: startOfCurrentMonthUtc() });

  if (spentMinor >= capMinor) {
    throw new Error(
      `AI spend limit reached for this ${context.territoryId ? "territory" : "organisation"} this month ($${(capMinor / 100).toFixed(2)}). Try again next month.`
    );
  }
}

type NewsletterAiTask = { taskKey: string; purpose: string; feature: string };

const NEWSLETTER_TASKS = {
  subjectLines: { taskKey: "marketing.subject_lines", purpose: "Suggest newsletter subject lines", feature: "subject_lines" },
  blockCopy: { taskKey: "marketing.block_copy", purpose: "Suggest newsletter paragraph copy", feature: "block_copy" },
  campaignDraft: { taskKey: "marketing.campaign_draft", purpose: "Draft a whole newsletter campaign from a brief", feature: "campaign_draft" }
} as const satisfies Record<string, NewsletterAiTask>;

/**
 * Runs a gateway call and leaves an ai_runs record whether it succeeds or fails, so every
 * newsletter AI call has actor, purpose, source draft, input, output, model and approval
 * state. Suggestions stay `pending` until the user accepts them in the editor.
 */
async function trackNewsletterRun<T extends Record<string, unknown> | string[] | string>(
  context: MarketingActorContext,
  task: NewsletterAiTask,
  subject: { draftId: string },
  input: Record<string, unknown>,
  call: () => Promise<AiSuggestionResult<T>>
): Promise<AiSuggestionResult<T>> {
  const startedAt = Date.now();
  const { db, sql: closeSql } = createDb();
  const store = createDrizzleAiRunStore(db);
  const base = {
    taskKey: task.taskKey,
    purpose: task.purpose,
    risk: "low" as const,
    actorType: "human" as const,
    actorUserId: context.userId,
    organisationId: context.organisationId ?? null,
    territoryId: context.territoryId ?? null,
    subjectType: "email_campaign_draft",
    subjectId: subject.draftId,
    sourceRefs: [{ type: "email_campaign_draft", id: subject.draftId }],
    input: boundForStorage(input)
  };

  try {
    let result: AiSuggestionResult<T>;
    try {
      result = await call();
    } catch (error) {
      await store.insert(
        {
          ...base,
          promptVersion: "unknown",
          providerKey: "unknown",
          modelReference: "unknown",
          status: "failed",
          approvalState: "not_required",
          output: {},
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostMinor: 0,
          latencyMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error"
        },
        new Date()
      );
      throw error;
    }

    await store.insert(
      {
        ...base,
        promptVersion: result.promptTemplateVersion,
        providerKey: result.providerKey,
        modelReference: result.modelReference,
        status: "succeeded",
        approvalState: "pending",
        output: { result: result.output as unknown as Record<string, unknown> | string[] | string },
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        estimatedCostMinor: estimateCost(result.modelReference, result.usage),
        latencyMs: Date.now() - startedAt,
        error: null
      },
      new Date()
    );
    return result;
  } finally {
    await closeSql.end();
  }
}

/** The user accepted a suggestion: approve their latest undecided run for that draft and task and mark it applied. */
async function markLatestRunAccepted(context: MarketingActorContext, input: { draftId: string; taskKey: string }) {
  const { db, sql: closeSql } = createDb();

  try {
    const store = createDrizzleAiRunStore(db);
    const [latest] = await store.list({ taskKeys: [input.taskKey], approvalStates: ["pending"], subjectType: "email_campaign_draft", subjectId: input.draftId, limit: 20 }).then((runs) => runs.filter((run) => run.actorUserId === context.userId));

    if (latest) {
      const now = new Date();
      await store.decide(latest.id, { state: "approved", userId: context.userId, note: "Accepted in the editor" }, now);
      await store.markApplied(latest.id, now);
    }
  } finally {
    await closeSql.end();
  }
}

function requireGateway(): AiGateway {
  const gateway = createAiGatewayFromEnv();

  if (!gateway) {
    throw new Error("AI assist is not configured for this environment.");
  }

  return gateway;
}

export async function suggestSubjectLines(
  context: MarketingActorContext,
  input: { draftId: string; campaignTitle: string; bodyPreviewText: string }
): Promise<string[]> {
  requireAiAssistPermission(context);
  await enforceAiAssistRateLimit(context);
  await enforceAiSpendCap(context);
  const gateway = requireGateway();
  const result = await trackNewsletterRun(
    context,
    NEWSLETTER_TASKS.subjectLines,
    input,
    { campaignTitle: input.campaignTitle, bodyPreviewText: input.bodyPreviewText },
    () => gateway.generateSubjectLines({ campaignTitle: input.campaignTitle, bodyPreviewText: input.bodyPreviewText })
  );

  await recordAiUsageEvent(context, {
    feature: "subject_lines",
    providerKey: result.providerKey,
    modelReference: result.modelReference,
    usage: result.usage
  });

  await recordSuggestionEvent(context, auditActions.marketingAiSuggestionGenerate, {
    task: "subject_lines",
    draftId: input.draftId,
    providerKey: result.providerKey,
    modelReference: result.modelReference,
    promptTemplateVersion: result.promptTemplateVersion,
    output: result.output
  });

  return result.output;
}

export async function suggestBlockCopy(
  context: MarketingActorContext,
  input: { draftId: string; blockId: string; campaignTitle: string; existingText?: string | null }
): Promise<string> {
  requireAiAssistPermission(context);
  await enforceAiAssistRateLimit(context);
  await enforceAiSpendCap(context);
  const gateway = requireGateway();
  const result = await trackNewsletterRun(
    context,
    NEWSLETTER_TASKS.blockCopy,
    input,
    { campaignTitle: input.campaignTitle, existingText: input.existingText, blockId: input.blockId },
    () => gateway.generateContentSuggestion({ campaignTitle: input.campaignTitle, existingText: input.existingText })
  );

  await recordAiUsageEvent(context, {
    feature: "block_copy",
    providerKey: result.providerKey,
    modelReference: result.modelReference,
    usage: result.usage
  });

  await recordSuggestionEvent(context, auditActions.marketingAiSuggestionGenerate, {
    task: "block_copy",
    draftId: input.draftId,
    blockId: input.blockId,
    providerKey: result.providerKey,
    modelReference: result.modelReference,
    promptTemplateVersion: result.promptTemplateVersion,
    output: result.output
  });

  return result.output;
}

/**
 * Populates a whole draft (subject + a few blocks) from a one-line prompt.
 * Returns the raw model output unvalidated - the caller (the newsletters
 * server action) must run it through validateBlocks + sanitizeRichTextHtml,
 * the exact same trust boundary every user-submitted block already goes
 * through. AI-generated content gets zero special trust.
 */
export async function generateCampaignDraft(
  context: MarketingActorContext,
  input: { draftId: string; prompt: string; audienceDescription?: string | null }
): Promise<CampaignDraft> {
  requireAiAssistPermission(context);
  await enforceAiAssistRateLimit(context);
  await enforceAiSpendCap(context);
  const gateway = requireGateway();
  const result = await trackNewsletterRun(
    context,
    NEWSLETTER_TASKS.campaignDraft,
    input,
    { prompt: input.prompt, audienceDescription: input.audienceDescription },
    () => gateway.generateCampaignDraft({ prompt: input.prompt, audienceDescription: input.audienceDescription })
  );

  await recordAiUsageEvent(context, {
    feature: "campaign_draft",
    providerKey: result.providerKey,
    modelReference: result.modelReference,
    usage: result.usage
  });

  await recordSuggestionEvent(context, auditActions.marketingAiSuggestionGenerate, {
    task: "campaign_draft",
    draftId: input.draftId,
    providerKey: result.providerKey,
    modelReference: result.modelReference,
    promptTemplateVersion: result.promptTemplateVersion,
    prompt: input.prompt,
    blockCount: result.output.blocks.length
  });

  return result.output;
}

export async function recordAiSuggestionAccepted(
  context: MarketingActorContext,
  input: { draftId: string; task: "subject_lines" | "block_copy"; blockId?: string; accepted: string }
): Promise<void> {
  requireAiAssistPermission(context);
  await recordSuggestionEvent(context, auditActions.marketingAiSuggestionAccept, {
    task: input.task,
    draftId: input.draftId,
    blockId: input.blockId ?? null,
    accepted: input.accepted
  });
  await markLatestRunAccepted(context, {
    draftId: input.draftId,
    taskKey: input.task === "subject_lines" ? NEWSLETTER_TASKS.subjectLines.taskKey : NEWSLETTER_TASKS.blockCopy.taskKey
  });
}

async function recordSuggestionEvent(context: MarketingActorContext, action: string, payload: Record<string, unknown>) {
  const { db, sql } = createDb();

  try {
    await recordAuditEvent(db, {
      action,
      actor: { type: "human", userId: context.userId },
      entity: { type: "email_campaign_draft", id: payload.draftId as string },
      scope: { territoryId: context.territoryId ?? undefined },
      after: payload
    });
  } finally {
    await sql.end();
  }
}

// ---- AI run console (AI-001) -------------------------------------------------------

const runPermission = (key: keyof typeof aiRunCapabilities) => ({ id: `ai.run.${aiRunCapabilities[key].action}`, ...aiRunCapabilities[key] });
const runGrant = (roleId: string, key: keyof typeof aiRunCapabilities, scope: string) => ({ roleId, permission: runPermission(key), scope, constraints: {} });

export const aiRunPermissionData: PermissionData = {
  roleAssignments: [
    { id: "fixture_assignment_hq", userId: fixtureIds.users.superAdmin, roleId: fixtureIds.roles.hqAdmin, organisationId: fixtureIds.organisations.hq },
    {
      id: "fixture_assignment_franchisee",
      userId: fixtureIds.users.franchisee,
      roleId: fixtureIds.roles.franchisee,
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield
    }
  ],
  territories: [
    { id: fixtureIds.territories.suttonColdfield, franchiseOrganisationId: fixtureIds.organisations.franchise },
    { id: fixtureIds.territories.solihull, franchiseOrganisationId: null }
  ],
  rolePermissions: [
    runGrant(fixtureIds.roles.hqAdmin, "view", "network"),
    runGrant(fixtureIds.roles.hqAdmin, "decide", "network"),
    runGrant(fixtureIds.roles.franchisee, "view", "own_territory"),
    runGrant(fixtureIds.roles.franchisee, "decide", "own_territory")
  ]
};

export function hasAiRunCapability(context: AiActorContext, capability: keyof typeof aiRunCapabilities) {
  const { module, action } = aiRunCapabilities[capability];
  return evaluatePermission(
    { userId: context.userId, module, action, context: { organisationId: context.organisationId ?? undefined, territoryId: context.territoryId ?? undefined } },
    aiRunPermissionData
  ).allowed;
}

export async function readAiRuns(context: AiActorContext, filter: { approvalStates?: AiApprovalState[] } = {}) {
  const { db, sql: closeSql } = createDb();

  try {
    return await listAiRunsForActor(context, aiRunPermissionData, createDrizzleAiRunStore(db), { limit: 200, ...filter });
  } finally {
    await closeSql.end();
  }
}

export async function readAiRun(context: AiActorContext, runId: string) {
  const { db, sql: closeSql } = createDb();

  try {
    return await getAiRunForActor(context, aiRunPermissionData, createDrizzleAiRunStore(db), runId);
  } finally {
    await closeSql.end();
  }
}

export async function decideAiRunAsActor(context: AiActorContext, runId: string, decision: { state: "approved" | "rejected"; note?: string | null }) {
  const { db, sql: closeSql } = createDb();

  try {
    return await db.transaction(async (tx) =>
      decideAiRun(
        context,
        aiRunPermissionData,
        { record: (input) => recordAuditEvent(tx, input) },
        createDrizzleAiRunStore(tx as unknown as Parameters<typeof createDrizzleAiRunStore>[0]),
        runId,
        decision
      )
    );
  } finally {
    await closeSql.end();
  }
}

// ---- Generic task runner (AI-001/002/003) -----------------------------------------

/** Task keys that may be routed to an existing workflow exposed as a service (see docs/AI_AUTOMATION.md). */
const ROUTABLE_TASK_KEYS = ["content.draft", "events.discover"];

/**
 * Runs an AI task as `context`, with everything the guardrails require: the task's
 * permission against the caller's own permission data, the per-territory rate limit,
 * the monthly spend cap, routing to an external workflow when one is configured, an
 * ai_runs record (success or failure), a usage event so spend caps see it, and an audit
 * event. UI and domain code call this; they never call a model directly.
 */
export async function runAiTaskAsActor<Input, Output extends Record<string, unknown>>(
  context: MarketingActorContext,
  permissions: PermissionData,
  task: AiTask<Input, Output>,
  request: { input: Input; subject?: { type: string; id: string } }
): Promise<{ run: AiRunRecord; output: Output }> {
  const provider = createAiProviderFromEnv();

  if (!provider) {
    throw new Error("AI assist is not configured for this environment.");
  }

  const { db, sql: closeSql } = createDb();

  try {
    const result = await runAiTask(
      {
        provider,
        workflows: createExternalWorkflowsFromEnv(ROUTABLE_TASK_KEYS),
        store: createDrizzleAiRunStore(db),
        audit: { record: (input) => recordAuditEvent(db, input) },
        guard: async () => {
          requirePermission(
            {
              userId: context.userId,
              module: task.capability.module,
              action: task.capability.action,
              context: { organisationId: context.organisationId ?? undefined, territoryId: context.territoryId ?? undefined }
            },
            permissions
          );
          await enforceAiAssistRateLimit(context);
          await enforceAiSpendCap(context);
        }
      },
      task,
      {
        input: request.input,
        actor: { type: "human", userId: context.userId },
        scope: { organisationId: context.organisationId, territoryId: context.territoryId },
        subject: request.subject
      }
    );

    if (context.organisationId) {
      await db.insert(aiUsageEvents).values({
        organisationId: context.organisationId,
        territoryId: context.territoryId ?? null,
        actorUserId: context.userId,
        feature: task.key,
        providerKey: result.run.providerKey,
        modelReference: result.run.modelReference,
        inputTokens: result.run.inputTokens,
        outputTokens: result.run.outputTokens,
        estimatedCostMinor: result.run.estimatedCostMinor
      });
    }

    return result;
  } finally {
    await closeSql.end();
  }
}
