import { createHash } from "node:crypto";
import { createDb, franchiseAgreements } from "@raring2go/db";
import { findRequestByProviderId, loadFranchiseData, signESignBody } from "@raring2go/franchise";
import type { ESignProvider } from "@raring2go/franchise";
import {
  SignWellError,
  cancelSignWellDocument,
  createSignWellDocument,
  getSignWellCompletedPdfUrl,
  getSignWellDocument,
  parseSignWellEvent,
  remindSignWellDocument,
  verifySignWellHash
} from "@raring2go/integrations";
import { eq } from "drizzle-orm";
import { agreementContentFrom, renderAgreementPdf } from "./agreement-pdf";
import { allowedArtifactHosts } from "./esign-artifacts";
import { esignWebhookSecrets, processESignWebhook } from "./esign-runtime";
import type { ESignWebhookOutcome } from "./esign-runtime";
import type { FileProviders } from "./franchise-files";
import { appLogger } from "./logger";

/**
 * SignWell as the e-signature provider (docs/SIGNWELL.md): sending the agreement as a PDF with an ordered signature
 * page, reminders and cancel, and a translator that turns SignWell's callbacks into the platform's provider-neutral
 * events. Nothing a callback says is believed until SignWell's own API confirms it.
 */

export const signWellConfigured = (env: Record<string, string | undefined> = process.env) => Boolean(env.SIGNWELL_API_KEY);
/** Documents are test documents (watermarked, not legally binding) unless this is explicitly turned off. */
export const signWellTestMode = (env: Record<string, string | undefined> = process.env) => env.SIGNWELL_TEST_MODE !== "false";
const apiKey = () => process.env.SIGNWELL_API_KEY ?? "";
const webhookIds = () => [process.env.SIGNWELL_WEBHOOK_ID, process.env.SIGNWELL_WEBHOOK_ID_PREVIOUS].filter((id): id is string => Boolean(id));

export async function loadAgreementForSigning(agreementId: string) {
  const { db, sql } = createDb();
  try {
    const [agreement] = await db.select().from(franchiseAgreements).where(eq(franchiseAgreements.id, agreementId));
    if (!agreement) throw new Error("The agreement was not found.");
    return agreementContentFrom(agreement.generatedContent as Record<string, unknown>, `Agreement ${agreement.id}`);
  } finally {
    await sql.end();
  }
}

export function signWellProvider(options: { apiKey: string; testMode: boolean; fetch?: typeof fetch; load?: typeof loadAgreementForSigning }): ESignProvider {
  const load = options.load ?? loadAgreementForSigning;
  return {
    key: "signwell",
    async send(input) {
      const content = await load(input.agreementId);
      const pdf = await renderAgreementPdf(content);
      const ordered = [...input.signers].sort((left, right) => left.signingOrder - right.signingOrder);
      const document = await createSignWellDocument({
        apiKey: options.apiKey,
        testMode: options.testMode,
        name: content.title,
        subject: `Please sign: ${content.title}`,
        message: "Please review and sign this agreement. Signers sign in the order shown.",
        pdf: { name: "agreement.pdf", base64: Buffer.from(pdf).toString("base64") },
        recipients: ordered.map((signer) => ({ id: String(signer.signingOrder), name: signer.name, email: signer.email })),
        metadata: { agreement_id: input.agreementId },
        expiresInDays: 30,
        fetch: options.fetch
      });
      return { providerRequestId: document.id, metadata: { provider: "signwell", testMode: options.testMode, pdfSha256: createHash("sha256").update(pdf).digest("hex") } };
    },
    async resend(input) {
      if (!input.providerRequestId) throw new Error("There is no signing request to remind.");
      await remindSignWellDocument({ apiKey: options.apiKey, documentId: input.providerRequestId, fetch: options.fetch });
      return { metadata: { reminded: true } };
    },
    async cancel(input) {
      if (input.providerRequestId) await cancelSignWellDocument({ apiKey: options.apiKey, documentId: input.providerRequestId, fetch: options.fetch });
      return { metadata: { cancelled: true } };
    }
  };
}

// ---- Webhook translator -------------------------------------------------------------------------

export class SignWellWebhookAuthError extends Error {}
export class SignWellWebhookMalformedError extends Error {}
/** SignWell has not caught up with its own event yet: answer with an error so it retries. */
export class SignWellNotReadyError extends Error {}

/** An event older than this is not processed: a captured genuine event cannot be replayed indefinitely. */
export const SIGNWELL_EVENT_MAX_AGE_SECONDS = 3 * 86_400;

type TranslatorDeps = { fetch?: typeof fetch; providers?: FileProviders; hosts?: string[]; webhookIds?: string[]; nowSeconds?: number };

const STATUS_FOR: Record<string, string[]> = {
  completed: ["Completed", "Manually completed"],
  declined: ["Declined"],
  expired: ["Expired"],
  cancelled: ["Canceled"]
};

export async function processSignWellWebhook(rawBody: string, deps: TranslatorDeps = {}): Promise<ESignWebhookOutcome & { events?: number }> {
  let parsed;
  try {
    parsed = parseSignWellEvent(JSON.parse(rawBody));
  } catch (error) {
    if (error instanceof SignWellError || error instanceof SyntaxError) throw new SignWellWebhookMalformedError("Malformed event.");
    throw error;
  }
  // Authenticity first: the hash proves type and time came from SignWell; the body is then confirmed against its API.
  if (!verifySignWellHash({ type: parsed.type, time: parsed.time, hash: parsed.hash, webhookIds: deps.webhookIds ?? webhookIds() })) throw new SignWellWebhookAuthError("Bad hash.");
  const nowSeconds = deps.nowSeconds ?? Math.floor(Date.now() / 1000);
  const eventSeconds = Number(parsed.time);
  if (!Number.isFinite(eventSeconds) || Math.abs(nowSeconds - eventSeconds) > SIGNWELL_EVENT_MAX_AGE_SECONDS) throw new SignWellWebhookAuthError("Stale event.");
  if (parsed.kind === "ignored") return { outcome: "ignored", reason: "not_an_event_we_act_on" };

  const secret = esignWebhookSecrets()[0];
  if (!secret) throw new Error("ESIGN_WEBHOOK_SECRET is not set; SignWell events cannot be applied.");
  const key = apiKey();
  let document;
  try {
    document = await getSignWellDocument({ apiKey: key, documentId: parsed.documentId, fetch: deps.fetch });
  } catch (error) {
    // SignWell has no such document: not ours, and retrying will never change that.
    if (error instanceof SignWellError && error.status === 404) return { outcome: "ignored", reason: "unknown_document" };
    throw error;
  }
  if (document.id !== parsed.documentId) return { outcome: "ignored", reason: "document_mismatch" };

  // Only a document we sent, for an agreement we know, is of any interest.
  const { db, sql } = createDb();
  let signerOrder: Array<{ order: number; email: string; completed: boolean }>;
  try {
    const data = await loadFranchiseData(db);
    const request = findRequestByProviderId(data, parsed.documentId);
    if (!request) return { outcome: "ignored", reason: "unknown_request" };
    if (document.metadata.agreement_id && request.franchiseAgreementId && document.metadata.agreement_id !== request.franchiseAgreementId) {
      appLogger.warn("signwell event did not match our agreement reference", { documentId: parsed.documentId });
      return { outcome: "ignored", reason: "unconfirmed" };
    }
    signerOrder = (data.signers ?? []).filter((signer) => signer.signatureRequestId === request.id).sort((left, right) => left.signingOrder - right.signingOrder).map((signer) => ({ order: signer.signingOrder, email: signer.email, completed: signer.status === "completed" }));
  } finally {
    await sql.end();
  }

  const status = document.status;
  const forward = (event: Record<string, unknown>) => {
    const body = JSON.stringify({ providerRequestId: parsed.documentId, ...event });
    return processESignWebhook(
      { rawBody: body, signatureHeader: signESignBody(secret, body, nowSeconds), nowSeconds },
      { fetch: deps.fetch, providers: deps.providers, hosts: deps.hosts ?? [...allowedArtifactHosts(), "www.signwell.com"] }
    );
  };
  const base = `signwell:${parsed.documentId}`;

  if (parsed.kind === "signer_completed") {
    const email = parsed.relatedSignerEmail?.trim().toLowerCase();
    if (!email || !document.recipients.some((recipient) => recipient.email.trim().toLowerCase() === email)) return { outcome: "ignored", reason: "unconfirmed" };
    if (["Declined", "Canceled", "Expired", "Error", "Bounced", "Blocked"].includes(status)) return { outcome: "ignored", reason: "unconfirmed" };
    return forward({ eventId: `${base}:signed:${email}`, type: "signer.completed", signerEmail: email });
  }

  if (!STATUS_FOR[parsed.kind]!.includes(status)) {
    // SignWell's own record disagrees with the event: it is either stale, or not from SignWell at all.
    if (parsed.kind === "completed" && ["Sent", "Pending", "Viewed", "Sending", "Created"].includes(status)) throw new SignWellNotReadyError("The document is not completed yet; retry.");
    return { outcome: "ignored", reason: "unconfirmed" };
  }

  if (parsed.kind === "completed") {
    // A completed document means every signer has signed. Record any we did not hear about, in order, then execute.
    for (const signer of signerOrder.filter((entry) => !entry.completed)) {
      await forward({ eventId: `${base}:signed:${signer.email.toLowerCase()}`, type: "signer.completed", signerEmail: signer.email });
    }
    const [signed, certificate] = await Promise.all([
      getSignWellCompletedPdfUrl({ apiKey: key, documentId: parsed.documentId, auditPage: false, fetch: deps.fetch }),
      getSignWellCompletedPdfUrl({ apiKey: key, documentId: parsed.documentId, auditPage: true, fetch: deps.fetch })
    ]);
    return forward({ eventId: `${base}:completed`, type: "completed", artifacts: [{ kind: "signed_agreement", url: signed }, { kind: "completion_certificate", url: certificate }] });
  }
  return forward({ eventId: `${base}:${parsed.kind}`, type: parsed.kind });
}
