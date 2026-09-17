import { auditActions, recordAuditEvent } from "@raring2go/audit";
import { createAiGatewayFromEnv } from "@raring2go/ai";
import type { AiGateway, AiUsage, CampaignDraft } from "@raring2go/ai";
import { createDevelopmentMemoryRateLimiter } from "@raring2go/auth";
import type { RateLimiter } from "@raring2go/auth";
import { aiUsageEvents, createDb } from "@raring2go/db";
import { evaluatePermission, requirePermission } from "@raring2go/permissions";
import { marketingCapabilities } from "@raring2go/marketing";
import type { MarketingActorContext } from "@raring2go/marketing";
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

// USD cents per million tokens. NOT verified against Anthropic's current
// published pricing (anthropic.com/pricing) - confirm before relying on this
// for real budget decisions. DEFAULT_PRICING is deliberately on the higher
// side so an unrecognised model under-permits spend rather than over-permits it.
const MODEL_PRICING_CENTS_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 100, output: 500 },
  "claude-sonnet-5": { input: 300, output: 1500 },
  "claude-opus-5": { input: 1500, output: 7500 }
};
const DEFAULT_PRICING = { input: 1500, output: 7500 };

const DEFAULT_AI_SPEND_CAP_NETWORK_MINOR = 5000; // $50.00/month
const DEFAULT_AI_SPEND_CAP_TERRITORY_MINOR = 1000; // $10.00/month

/** Exported for direct unit testing - pure pricing arithmetic, no DB. */
export function estimateCostMinor(modelReference: string, usage: AiUsage): number {
  const pricing = MODEL_PRICING_CENTS_PER_MILLION_TOKENS[modelReference] ?? DEFAULT_PRICING;
  const costCents = (usage.inputTokens * pricing.input + usage.outputTokens * pricing.output) / 1_000_000;
  return Math.ceil(costCents);
}

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
  const result = await gateway.generateSubjectLines({
    campaignTitle: input.campaignTitle,
    bodyPreviewText: input.bodyPreviewText
  });

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
  const result = await gateway.generateContentSuggestion({
    campaignTitle: input.campaignTitle,
    existingText: input.existingText
  });

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
  const result = await gateway.generateCampaignDraft({
    prompt: input.prompt,
    audienceDescription: input.audienceDescription
  });

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
