import { NextResponse } from "next/server";
import {
  advanceJourneyExecution,
  claimNextJourneyExecution,
  executeJourneyStep,
  insertEmailRecipientSnapshotRecord,
  insertEmailSendJobRecordIfMissing,
  insertJourneyStepCampaignGraph,
  insertJourneyStepExecutionRecord,
  loadJourneyExecutionBundle,
  loadMarketingData,
  updateJourneyAudienceEntryRecord
} from "@raring2go/marketing";
import type { MarketingActorContext } from "@raring2go/marketing";
import { recordAuditEvent } from "@raring2go/audit";
import { createDb } from "@raring2go/db";
import type { PermissionData } from "@raring2go/permissions";

// Dedicated system identity, isolated from the human-facing marketingPermissionData
// fixture in lib/marketing-runtime.ts - this worker never acts on a human's behalf.
const WORKER_ACTOR_ID = "journey-execute-worker";
const WORKER_ROLE_ID = "journey-execute-worker-role";

const workerContext: MarketingActorContext = { userId: WORKER_ACTOR_ID };

const workerPermissions: PermissionData = {
  roleAssignments: [{ id: "journey-execute-worker-assignment", userId: WORKER_ACTOR_ID, roleId: WORKER_ROLE_ID }],
  rolePermissions: [
    grant("marketing.journey", "execute"),
    grant("marketing.audience", "view"),
    grant("marketing.email", "create"),
    grant("marketing.email", "approve"),
    grant("marketing.email", "schedule")
  ]
};

function grant(module: string, action: string) {
  return { roleId: WORKER_ROLE_ID, permission: { id: `journey-worker:${module}:${action}`, module, action }, scope: "network" };
}

function workerAudit(db: ReturnType<typeof createDb>["db"]) {
  return {
    record: async (input: {
      action: string;
      entityType: string;
      entityId?: string | null;
      organisationId?: string | null;
      territoryId?: string | null;
      payload?: Record<string, unknown>;
    }) => {
      await recordAuditEvent(db, {
        action: input.action,
        actor: { type: "system", systemId: "journey-execute-worker" },
        entity: { type: input.entityType, id: input.entityId ?? undefined },
        scope: { territoryId: input.territoryId ?? undefined },
        after: input.payload
      });
    }
  };
}

export async function GET(request: Request) {
  return processNextJourneyExecution(request);
}

export async function POST(request: Request) {
  return processNextJourneyExecution(request);
}

async function processNextJourneyExecution(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { db, sql } = createDb();

  try {
    const claimed = await claimNextJourneyExecution(db);

    if (!claimed) {
      return NextResponse.json({ claimed: false });
    }

    const bundle = await loadJourneyExecutionBundle(db, claimed.id);

    if (!bundle) {
      await advanceJourneyExecution(db, claimed.id, { status: "failed", failureReason: "missing_bundle" });
      return NextResponse.json({ claimed: true, executionId: claimed.id, error: "missing_bundle" });
    }

    if (bundle.journey.status !== "active") {
      await advanceJourneyExecution(db, claimed.id, { status: "failed", failureReason: "journey_not_active" });
      return NextResponse.json({ claimed: true, executionId: claimed.id, error: "journey_not_active" });
    }

    const stepKey = bundle.execution.currentStepKey;

    if (!stepKey) {
      await advanceJourneyExecution(db, claimed.id, { status: "failed", failureReason: "no_current_step" });
      return NextResponse.json({ claimed: true, executionId: claimed.id, error: "no_current_step" });
    }

    const data = await loadMarketingData(db);
    let execution;

    try {
      execution = await executeJourneyStep(workerContext, workerPermissions, workerAudit(db), data, claimed.id, stepKey, new Date().toISOString());
    } catch (error) {
      // Whatever partial in-memory state executeJourneyStep left behind (e.g. the
      // suppression-check path already sets a failure reason before throwing) is
      // not trusted here - always persist a definite "failed" outcome so a bug
      // elsewhere can't leave the row stuck in "processing" forever.
      await advanceJourneyExecution(db, claimed.id, {
        status: "failed",
        failureReason: error instanceof Error ? error.message : "unknown_error"
      });
      return NextResponse.json({ claimed: true, executionId: claimed.id, error: "step_failed" });
    }

    const stepExecution = data.journeyStepExecutions.find(
      (candidate) => candidate.executionId === execution.id && candidate.stepKey === stepKey
    )!;

    if (stepExecution.actionType === "send_email") {
      const output = stepExecution.output as { campaignId: string; campaignVersionId: string; snapshotId: string; jobId: string };
      const campaign = data.emailCampaigns.find((candidate) => candidate.id === output.campaignId)!;
      const version = data.emailCampaignVersions.find((candidate) => candidate.id === output.campaignVersionId)!;
      const snapshot = data.emailRecipientSnapshots.find((candidate) => candidate.id === output.snapshotId)!;
      const job = data.emailSendJobs.find((candidate) => candidate.id === output.jobId)!;
      await insertJourneyStepCampaignGraph(db, { campaign, version });
      await insertEmailRecipientSnapshotRecord(db, snapshot);
      await insertEmailSendJobRecordIfMissing(db, job);
    }

    await insertJourneyStepExecutionRecord(db, stepExecution);
    await advanceJourneyExecution(db, execution.id, {
      status: execution.status,
      currentStepKey: execution.currentStepKey,
      runAfter: execution.runAfter,
      completedAt: execution.completedAt,
      failureReason: execution.failureReason
    });

    if (execution.status === "completed") {
      const entry = data.journeyAudienceEntries.find((candidate) => candidate.id === execution.entryId)!;
      await updateJourneyAudienceEntryRecord(db, entry);
    }

    return NextResponse.json({ claimed: true, executionId: execution.id, status: execution.status, stepKey });
  } finally {
    await sql.end();
  }
}

function isAuthorizedCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return process.env.APP_ENV !== "production";
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}
