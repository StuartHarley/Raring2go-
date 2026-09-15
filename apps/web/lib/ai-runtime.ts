import { auditActions, recordAuditEvent } from "@raring2go/audit";
import { createAiGatewayFromEnv } from "@raring2go/ai";
import type { AiGateway } from "@raring2go/ai";
import { createDevelopmentMemoryRateLimiter } from "@raring2go/auth";
import type { RateLimiter } from "@raring2go/auth";
import { createDb } from "@raring2go/db";
import { evaluatePermission, requirePermission } from "@raring2go/permissions";
import { marketingCapabilities } from "@raring2go/marketing";
import type { MarketingActorContext } from "@raring2go/marketing";
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
  const gateway = requireGateway();
  const result = await gateway.generateSubjectLines({
    campaignTitle: input.campaignTitle,
    bodyPreviewText: input.bodyPreviewText
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
  const gateway = requireGateway();
  const result = await gateway.generateContentSuggestion({
    campaignTitle: input.campaignTitle,
    existingText: input.existingText
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
