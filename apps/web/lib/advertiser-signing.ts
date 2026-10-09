import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "@raring2go/audit";
import { createDb } from "@raring2go/db";
import {
  SIGNATURE_LAPSED,
  closePendingAcceptance,
  finaliseSignedAcceptance,
  loadAdvertisingData,
  persistAdvertisingChanges,
  portalRespondToProposal,
  resolvePortalIdentity,
  snapshotAdvertisingData
} from "@raring2go/advertising";
import { SignWellError, createSignWellDocument, getSignWellCompletedPdfUrl, getSignWellDocument } from "@raring2go/integrations";
import type { SignWellDocument } from "@raring2go/integrations";
import { claimWebhookEvent } from "@raring2go/security";
import { sql as rawSql } from "drizzle-orm";
import { systemAdvertisingIdentity } from "./advertising-system";
import { agreementContentFrom, renderAgreementPdf } from "./agreement-pdf";
import type { AgreementContent } from "./agreement-pdf";
import { allowedArtifactHosts, fetchSignedArtifact } from "./esign-artifacts";
import { defaultFileProviders, saveFileReference, storeDocumentFile } from "./franchise-files";
import type { FileProviders } from "./franchise-files";
import { appLogger } from "./logger";
import { getPermissionData } from "./permission-source";
import { mutateAsAdvertiser, requirePortalAccess } from "./portal-runtime";
import type { PortalActorContext } from "./portal-runtime";
import { signWellConfigured, signWellTestMode } from "./signwell-config";

/**
 * An advertiser accepting a proposal signs it with SignWell (decision: SignWell for e-signature). Acceptance waits as
 * `pending_signature` until SignWell confirms the signature; only then is the booking made. Turn off with
 * `SIGNWELL_ADVERTISER_ACCEPTANCE=off` to fall back to the simple acceptance.
 */
export const advertiserSigningEnabled = (env: Record<string, string | undefined> = process.env) => signWellConfigured(env) && env.SIGNWELL_ADVERTISER_ACCEPTANCE !== "off";

const SYSTEM_USER = "00000000-0000-4000-8000-000000000203";
const apiKey = () => process.env.SIGNWELL_API_KEY ?? "";
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const money = (minor: number, currency: string) => `${currency === "GBP" ? "GBP " : `${currency} `}${(minor / 100).toFixed(2)}`;

type SnapshotItem = { description: string; quantity: number; totalPriceMinor: number; currency: string };

/** The document the advertiser signs: who, what, the price, how long it is valid, and the approved terms they accept. */
export function acceptanceContent(input: { advertiserName: string; contactName: string; snapshot: Record<string, unknown>; termsTitle: string; termsContent: Record<string, unknown>; reference: string }): AgreementContent {
  const proposal = (input.snapshot.proposal ?? {}) as { title?: string; totalValueMinor?: number; currency?: string; validUntil?: string | null; version?: number };
  const items = ((input.snapshot.items ?? []) as SnapshotItem[]).map((item) => `- ${item.description} (quantity ${item.quantity}): ${money(item.totalPriceMinor, item.currency)}`);
  const currency = proposal.currency ?? "GBP";
  const terms = agreementContentFrom(input.termsContent, input.reference);
  return {
    title: `Proposal acceptance: ${proposal.title ?? "Proposal"}`,
    reference: input.reference,
    paragraphs: [
      { text: `Advertiser: ${input.advertiserName}\nSigned by: ${input.contactName}\nProposal version: ${proposal.version ?? 1}\nValid until: ${proposal.validUntil ?? "not stated"}` },
      { heading: "What you are agreeing to buy", text: `${items.join("\n") || "As set out in the proposal."}\n\nTotal (excluding VAT where shown separately on the invoice): ${money(proposal.totalValueMinor ?? 0, currency)}` },
      { heading: terms.title || input.termsTitle, text: terms.paragraphs.map((paragraph) => [paragraph.heading, paragraph.text].filter(Boolean).join("\n")).join("\n\n") || input.termsTitle },
      { text: "By signing, you accept this proposal on the terms above. A booking is confirmed only once your signature is complete." }
    ]
  };
}

type Deps = { fetch?: typeof fetch };

/**
 * Accept a proposal by signature. Returns where to send the advertiser to sign. Safe to repeat: a signing already
 * under way returns the same document's signing page; a lapsed one starts a new attempt.
 */
export async function acceptProposalForSignature(context: PortalActorContext, proposalId: string, deps: Deps = {}): Promise<{ signingUrl: string | null; acceptanceId: string; resumed: boolean }> {
  requirePortalAccess(await getPermissionData(), context);

  const acceptance = await mutateAsAdvertiser(context, (identity, data, audit, permissions) => {
    const attempt = data.acceptances.filter((candidate) => candidate.proposalId === proposalId && !candidate.deletedAt && candidate.status === SIGNATURE_LAPSED).length + 1;
    return portalRespondToProposal(identity, permissions, audit, data, {
      proposalId,
      response: "accepted",
      respondedAt: new Date().toISOString().slice(0, 10),
      requestMetadata: { signature: "signwell" },
      ids: { acceptanceId: randomUUID(), bookingId: randomUUID(), domainEventId: randomUUID() },
      signature: { attempt, providerMetadata: { provider: "signwell" } }
    });
  });

  if (acceptance.status !== "pending_signature") return { signingUrl: null, acceptanceId: acceptance.id, resumed: false };

  const existingDocument = (acceptance.providerMetadata as { documentId?: string }).documentId;
  if (existingDocument) {
    const document = await getSignWellDocument({ apiKey: apiKey(), documentId: existingDocument, fetch: deps.fetch });
    return { signingUrl: document.recipients[0]?.signingUrl ?? null, acceptanceId: acceptance.id, resumed: true };
  }

  // Build and send the document. Anything that goes wrong lapses the acceptance so the advertiser can try again.
  const { db, sql } = createDb();
  try {
    const data = await loadAdvertisingData(db);
    const proposal = data.proposals.find((candidate) => candidate.id === acceptance.proposalId)!;
    const advertiser = data.advertisers.find((candidate) => candidate.id === acceptance.advertiserId)!;
    const contact = data.contacts.find((candidate) => candidate.id === acceptance.acceptedByContactId);
    const terms = data.terms.find((candidate) => candidate.id === acceptance.termsId);
    if (!contact?.email || !terms) throw new Error("The acceptance is missing a contact email or terms.");
    const contactName = contact.name?.trim() || contact.email;
    const advertiserName = data.organisations.find((organisation) => organisation.id === advertiser.advertiserOrganisationId)?.name ?? "Advertiser";
    const daysLeft = proposal.validUntil ? Math.max(1, Math.ceil((Date.parse(`${proposal.validUntil}T23:59:59Z`) - Date.now()) / 86_400_000)) : 30;

    let document: SignWellDocument;
    try {
      const content = acceptanceContent({ advertiserName, contactName, snapshot: acceptance.commercialSnapshot, termsTitle: terms.title, termsContent: terms.contentSnapshot, reference: `Acceptance ${acceptance.id}` });
      const pdf = await renderAgreementPdf(content);
      document = await createSignWellDocument({
        apiKey: apiKey(),
        testMode: signWellTestMode(),
        name: content.title,
        subject: `Please sign: ${content.title}`,
        message: "Please review and sign to accept this proposal. Your booking is confirmed once your signature is complete.",
        pdf: { name: "acceptance.pdf", base64: Buffer.from(pdf).toString("base64") },
        recipients: [{ id: "1", name: contactName, email: contact.email }],
        metadata: { acceptance_id: acceptance.id, proposal_id: proposal.id },
        expiresInDays: Math.min(30, daysLeft),
        redirectUrl: `${appUrl()}/app/portal?result=signing_returned`,
        declineRedirectUrl: `${appUrl()}/app/portal?result=signing_declined`,
        fetch: deps.fetch
      });
    } catch (error) {
      await mutateAsAdvertiser(context, (_identity, current, audit) =>
        closePendingAcceptance({ userId: context.userId, organisationId: context.organisationId }, audit, current, { acceptanceId: acceptance.id, outcome: "lapsed", reason: error instanceof Error ? error.message : "The signing request could not be sent.", on: new Date().toISOString().slice(0, 10) })
      );
      throw error;
    }

    await mutateAsAdvertiser(context, async (_identity, current) => {
      const row = current.acceptances.find((candidate) => candidate.id === acceptance.id)!;
      row.providerMetadata = { ...row.providerMetadata, provider: "signwell", documentId: document.id, testMode: signWellTestMode(), sentOn: new Date().toISOString().slice(0, 10) };
    });
    return { signingUrl: document.recipients[0]?.signingUrl ?? null, acceptanceId: acceptance.id, resumed: false };
  } finally {
    await sql.end();
  }
}

// ---- Callbacks ------------------------------------------------------------------------------

export type AdvertiserSigningOutcome = { outcome: "processed" | "duplicate" | "ignored"; reason?: string };

const STATUS_FOR: Record<string, string[]> = { completed: ["Completed", "Manually completed"], declined: ["Declined"], expired: ["Expired"], cancelled: ["Canceled"] };

/**
 * A confirmed SignWell event for an advertiser's acceptance, or `null` when the document is not one of ours.
 * `document` is SignWell's own record (fetched by the caller), so its status is what we believe, not the event body.
 */
export async function handleAdvertiserSigningEvent(
  event: { kind: string; documentId: string },
  document: SignWellDocument,
  deps: { fetch?: typeof fetch; providers?: FileProviders; hosts?: string[] } = {}
): Promise<AdvertiserSigningOutcome | null> {
  const { db, sql } = createDb();
  try {
    const rows = (await db.execute(rawSql`select id from advertiser_proposal_acceptances where provider_metadata->>'documentId' = ${event.documentId} and deleted_at is null limit 1`)) as unknown as Array<{ id: string }>;
    const acceptanceId = rows[0]?.id;
    if (!acceptanceId) return null;
    if (document.metadata.acceptance_id && document.metadata.acceptance_id !== acceptanceId) return { outcome: "ignored", reason: "unconfirmed" };
    // One signer, so a per-signer event adds nothing; the outcome is the document's own.
    if (event.kind === "signer_completed" || event.kind === "ignored") return { outcome: "ignored", reason: "not_an_event_we_act_on" };
    if (!STATUS_FOR[event.kind]?.includes(document.status)) {
      if (event.kind === "completed" && ["Sent", "Pending", "Viewed", "Sending", "Created"].includes(document.status)) throw new SignWellError("The document is not completed yet; retry.", true);
      return { outcome: "ignored", reason: "unconfirmed" };
    }

    const today = new Date().toISOString().slice(0, 10);
    const system = systemAdvertisingIdentity(SYSTEM_USER, "advertiser.signing");

    if (event.kind !== "completed") {
      return await db.transaction(async (tx) => {
        const scoped = tx as unknown as typeof db;
        if (!(await claimWebhookEvent(scoped, { providerKey: "signwell", eventId: `${event.documentId}:${event.kind}`, eventType: event.kind }))) return { outcome: "duplicate" as const };
        const data = await loadAdvertisingData(scoped);
        const before = snapshotAdvertisingData(data);
        await closePendingAcceptance(system.context, system.audit(scoped), data, { acceptanceId, outcome: event.kind === "declined" ? "declined" : "lapsed", reason: `Signing ${event.kind}.`, on: today });
        await persistAdvertisingChanges(scoped, before, data);
        return { outcome: "processed" as const };
      });
    }

    // Completed: keep the signed copy (with SignWell's audit page) before anything is booked.
    const providers = deps.providers ?? defaultFileProviders();
    const url = await getSignWellCompletedPdfUrl({ apiKey: apiKey(), documentId: event.documentId, auditPage: true, fetch: deps.fetch });
    const bytes = await fetchSignedArtifact(url, { hosts: deps.hosts ?? [...allowedArtifactHosts(), "www.signwell.com"], fetch: deps.fetch });
    const preload = await loadAdvertisingData(db);
    const acceptance = preload.acceptances.find((candidate) => candidate.id === acceptanceId)!;
    const owning = preload.territories.find((territory) => territory.id === acceptance.territoryId);
    if (!owning?.franchiseOrganisationId) throw new Error("The acceptance's territory has no franchise to file the signed copy under.");
    const file = await storeDocumentFile({ franchise: { organisationId: owning.franchiseOrganisationId, territoryId: acceptance.territoryId }, userId: null, fileName: `signed-acceptance-${acceptanceId}.pdf`, contentType: "application/pdf", bytes }, providers);

    try {
      return await db.transaction(async (tx) => {
        const scoped = tx as unknown as typeof db;
        if (!(await claimWebhookEvent(scoped, { providerKey: "signwell", eventId: `${event.documentId}:completed`, eventType: "completed" }))) return { outcome: "duplicate" as const };
        const data = await loadAdvertisingData(scoped);
        const before = snapshotAdvertisingData(data);
        await saveFileReference(scoped, file);
        await finaliseSignedAcceptance(system.context, system.permissions, system.audit(scoped), data, {
          acceptanceId, signedOn: today, bookingId: randomUUID(), domainEventId: randomUUID(), newId: randomUUID,
          providerMetadata: { signedFileId: file.id, signedFileName: file.fileName, signedSha256: file.checksum, signed: true }
        });
        await persistAdvertisingChanges(scoped, before, data);
        return { outcome: "processed" as const };
      });
    } catch (error) {
      // A business reason (slot taken, proposal expired) rather than a passing fault: they signed, so a person must follow up.
      if (error instanceof Error && !/^(Failed query|connect|read ECONN|The database)/.test(error.message)) {
        appLogger.warn("a signed acceptance could not be booked", { acceptanceId, reason: error.message });
        await db.transaction(async (tx) => {
          const scoped = tx as unknown as typeof db;
          if (!(await claimWebhookEvent(scoped, { providerKey: "signwell", eventId: `${event.documentId}:completed`, eventType: "completed" }))) return;
          const data = await loadAdvertisingData(scoped);
          const before = snapshotAdvertisingData(data);
          await saveFileReference(scoped, file);
          const closed = await closePendingAcceptance(system.context, system.audit(scoped), data, { acceptanceId, outcome: "lapsed", reason: `Signed, but not booked: ${error.message}`, on: today });
          if (closed) closed.providerMetadata = { ...closed.providerMetadata, signed: true, signedFileId: file.id, needsFollowUp: true };
          await persistAdvertisingChanges(scoped, before, data);
          await recordAuditEvent(scoped, { action: "advertiser.acceptance.signed_not_booked", actor: { type: "automation", automationId: "advertiser.signing" }, entity: { type: "advertiser_proposal_acceptance", id: acceptanceId }, after: { reason: error.message.slice(0, 200) } });
        });
        return { outcome: "processed", reason: "signed_not_booked" };
      }
      throw error;
    }
  } finally {
    await sql.end();
  }
}

