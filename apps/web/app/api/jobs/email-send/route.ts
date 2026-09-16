import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  advanceEmailSendJob,
  claimNextEmailSendJob,
  generateUnsubscribeToken,
  insertEmailDeliveryRecordRows,
  loadEmailSendJobBundle,
  nextEmailSendChunk,
  normalizeContentSnapshot,
  renderBlocksToHtml,
  renderBlocksToText,
  substituteMergeTags,
  updateEmailCampaignRecord
} from "@raring2go/marketing";
import { createEmailProviderFromEnv, createMicrosoftGraphEmailProvider, normalizeEmailAddress, sendEmailBatch } from "@raring2go/email";
import type { EmailDeliveryProvider, EmailMessage } from "@raring2go/email";
import type { EmailCampaign, EmailCampaignVersion, EmailSendJob } from "@raring2go/marketing";
import { auditActions, recordAuditEvent } from "@raring2go/audit";
import { createDb } from "@raring2go/db";
import { getValidMicrosoftAccessToken } from "../../../../lib/integrations-runtime";

const MAX_RETRY_DELAY_MS = 30 * 60 * 1000;

export async function GET(request: Request) {
  return processNextEmailSendJob(request);
}

export async function POST(request: Request) {
  return processNextEmailSendJob(request);
}

async function processNextEmailSendJob(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { db, sql } = createDb();

  try {
    const job = await claimNextEmailSendJob(db);

    if (!job) {
      return NextResponse.json({ claimed: false });
    }

    const bundle = await loadEmailSendJobBundle(db, job.id);

    if (!bundle) {
      await advanceEmailSendJob(db, job.id, {
        status: "failed",
        lastError: "Campaign, version or recipient snapshot no longer exists."
      });
      return NextResponse.json({ claimed: true, jobId: job.id, error: "missing_bundle" }, { status: 200 });
    }

    const { campaign, version, snapshot } = bundle;
    const { recipients, isFinalChunk } = nextEmailSendChunk(job, snapshot);

    if (recipients.length === 0) {
      await advanceEmailSendJob(db, job.id, { status: "completed" });
      await completeJob(db, job.id, campaign);
      return NextResponse.json({ claimed: true, jobId: job.id, sent: 0, completed: true });
    }

    let provider: EmailDeliveryProvider;

    try {
      provider = await resolveSendProvider(job);
    } catch (error) {
      await handleJobFailure(db, job, error instanceof Error ? error.message : "Unable to resolve send provider");
      return NextResponse.json({ claimed: true, jobId: job.id, error: "provider_unavailable" }, { status: 502 });
    }

    const snapshotContent = normalizeContentSnapshot(version.contentSnapshot, campaign.title);
    const html = renderBlocksToHtml(snapshotContent.blocks);
    const text = renderBlocksToText(snapshotContent.blocks);
    const messages = recipients.map((recipient) => buildMessage(campaign, version, recipient, html, text));

    let results;

    try {
      results = await sendEmailBatch(provider, messages);
    } catch (error) {
      await handleJobFailure(db, job, error instanceof Error ? error.message : "Unknown send error");
      return NextResponse.json({ claimed: true, jobId: job.id, error: "send_failed" }, { status: 502 });
    }

    await insertEmailDeliveryRecordRows(
      db,
      results.map((result, index) => ({
        id: randomUUID(),
        campaignId: campaign.id,
        campaignVersionId: version.id,
        recipientSnapshotId: snapshot.id,
        contactId: recipientContactId(recipients[index]),
        emailNormalised: messages[index]!.to[0]!.email,
        providerKey: result.providerKey,
        providerMessageId: result.providerMessageId,
        status: result.status,
        eventType: null,
        eventAt: null,
        metadata: {}
      }))
    );

    const newCursor = job.cursor + recipients.length;

    if (isFinalChunk) {
      await advanceEmailSendJob(db, job.id, { cursor: newCursor, status: "completed" });
      await completeJob(db, job.id, campaign);
    } else {
      await advanceEmailSendJob(db, job.id, { cursor: newCursor, status: "queued" });

      if (campaign.status !== "sending") {
        await updateEmailCampaignRecord(db, { ...campaign, status: "sending" });
      }
    }

    return NextResponse.json({ claimed: true, jobId: job.id, sent: recipients.length, completed: isFinalChunk });
  } finally {
    await sql.end();
  }
}

async function resolveSendProvider(job: EmailSendJob): Promise<EmailDeliveryProvider> {
  if (job.sendProvider === "microsoft") {
    if (!job.sendConnectionId) {
      throw new Error("Outlook send job has no connected mailbox.");
    }
    const connectionId = job.sendConnectionId;
    return createMicrosoftGraphEmailProvider({
      getAccessToken: () => getValidMicrosoftAccessToken(connectionId)
    });
  }

  return createEmailProviderFromEnv();
}

async function completeJob(db: ReturnType<typeof createDb>["db"], jobId: string, campaign: EmailCampaign) {
  const sentCampaign: EmailCampaign = { ...campaign, status: "sent", sentAt: new Date().toISOString() };
  await updateEmailCampaignRecord(db, sentCampaign);
  await recordAuditEvent(db, {
    action: auditActions.marketingEmailCampaignSend,
    actor: { type: "system", systemId: "email-send-worker" },
    entity: { type: "email_campaign", id: campaign.id },
    scope: { territoryId: campaign.territoryId ?? undefined },
    after: { sentAt: sentCampaign.sentAt, jobId }
  });
}

async function handleJobFailure(
  db: ReturnType<typeof createDb>["db"],
  job: { id: string; attempts: number; maxAttempts: number },
  message: string
) {
  const canRetry = job.attempts < job.maxAttempts;

  await advanceEmailSendJob(db, job.id, {
    status: canRetry ? "queued" : "failed",
    lastError: message,
    ...(canRetry ? { nextAttemptAt: new Date(Date.now() + retryDelayMs(job.attempts)).toISOString() } : {})
  });
}

function retryDelayMs(attempts: number) {
  return Math.min(60_000 * 2 ** attempts, MAX_RETRY_DELAY_MS);
}

function buildMessage(
  campaign: EmailCampaign,
  version: EmailCampaignVersion,
  recipient: Record<string, unknown>,
  html: string,
  text: string
): EmailMessage {
  const email = normalizeEmailAddress(String(recipient.emailNormalised ?? ""));
  const contactId = recipientContactId(recipient);
  const idempotencyKey = `${campaign.id}:${version.id}:${contactId ?? email}`;
  const mergeTagFields = recipientMergeTagFields(recipient);

  return {
    idempotencyKey,
    purpose: "newsletter",
    to: [{ email }],
    from: { email: process.env.EMAIL_FROM ?? "no-reply@raring2go.local", name: campaign.title },
    subject: substituteMergeTags(version.subject, mergeTagFields),
    text: substituteMergeTags(text, mergeTagFields),
    html: substituteMergeTags(html, mergeTagFields),
    headers: contactId ? listUnsubscribeHeaders(contactId, campaign.id) : undefined,
    metadata: { campaignId: campaign.id, contactId: contactId ?? "" }
  };
}

function recipientMergeTagFields(recipient: Record<string, unknown>) {
  const firstName = recipient.firstName;
  const lastName = recipient.lastName;
  return {
    firstName: typeof firstName === "string" ? firstName : null,
    lastName: typeof lastName === "string" ? lastName : null
  };
}

function recipientContactId(recipient: Record<string, unknown> | undefined) {
  const value = recipient?.contactId;
  return typeof value === "string" && value ? value : null;
}

function listUnsubscribeHeaders(contactId: string, campaignId: string) {
  const secret = process.env.AUDIENCE_UNSUBSCRIBE_SECRET;

  if (!secret) {
    return undefined;
  }

  const token = generateUnsubscribeToken(secret, contactId, campaignId);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  const url = `${baseUrl}/api/public/unsubscribe?c=${encodeURIComponent(contactId)}&m=${encodeURIComponent(campaignId)}&t=${encodeURIComponent(token)}`;

  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
  };
}

function isAuthorizedCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return process.env.APP_ENV !== "production";
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}
