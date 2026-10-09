import { createHash, randomUUID } from "node:crypto";
import { createDb } from "@raring2go/db";
import {
  ESignEventError,
  findRequestByProviderId,
  findSignerForEvent,
  loadFranchiseData,
  parseESignEvent,
  recordSignatureProviderEvent,
  syncSignatureRequestGraph,
  updateFranchiseAgreementState,
  verifyESignSignature
} from "@raring2go/franchise";
import type { ESignInboundEvent, FranchiseArtifactReference } from "@raring2go/franchise";
import { claimWebhookEvent } from "@raring2go/security";
import { ESignArtifactError, allowedArtifactHosts, assertArtifactUrlAllowed, fetchSignedArtifact } from "./esign-artifacts";
import { DocumentFileError, defaultFileProviders, saveFileReference, storeDocumentFile } from "./franchise-files";
import type { FileProviders } from "./franchise-files";
import { systemFranchiseIdentity } from "./franchise-system";

const PROVIDER_KEY = "esign";
const system = systemFranchiseIdentity("esign-webhook", "esign.webhook");

export class ESignAuthError extends Error {}

export type ESignWebhookOutcome = { outcome: "processed" | "duplicate" | "ignored"; reason?: string };

export function esignWebhookSecrets(source: NodeJS.ProcessEnv = process.env) {
  return [source.ESIGN_WEBHOOK_SECRET, source.ESIGN_WEBHOOK_SECRET_PREVIOUS].filter((secret): secret is string => Boolean(secret));
}

/** The authenticity check on its own, so a route can refuse an unsigned request before doing anything else with it. */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, nowSeconds?: number) {
  return verifyESignSignature({ header: signatureHeader, body: rawBody, secrets: esignWebhookSecrets(), nowSeconds });
}

/**
 * Applies one signed provider callback. The order is deliberate:
 *  1. verify the signature and timestamp (nothing is read or fetched for an unauthentic request);
 *  2. validate the event strictly, find our request by the provider's id (an unknown one is ignored, not an error);
 *  3. for `completed`, fetch the signed documents *outside* any transaction, from trusted hosts only, check hashes,
 *     scan and store them;
 *  4. in one transaction claim the event id, record the event and persist the agreement changes.
 * The claim is inside the transaction, so a failure rolls it back and the provider's retry is processed, while a
 * redelivery of an applied event changes nothing and fetches nothing twice.
 */
export async function processESignWebhook(
  input: { rawBody: string; signatureHeader: string | null; nowSeconds?: number },
  deps: { fetch?: typeof fetch; providers?: FileProviders; secrets?: string[]; hosts?: string[] } = {}
): Promise<ESignWebhookOutcome> {
  if (!verifyESignSignature({ header: input.signatureHeader, body: input.rawBody, secrets: deps.secrets ?? esignWebhookSecrets(), nowSeconds: input.nowSeconds })) {
    throw new ESignAuthError("The signature is not valid.");
  }
  const event = parseESignEvent(input.rawBody);

  const { db, sql } = createDb();
  try {
    const before = await loadFranchiseData(db);
    const request = findRequestByProviderId(before, event.providerRequestId);
    if (!request) return { outcome: "ignored", reason: "unknown_request" };
    const alreadyApplied = (before.signatureEvents ?? []).some((candidate) => candidate.signatureRequestId === request.id && candidate.providerEventId === event.eventId);
    if (alreadyApplied) return { outcome: "duplicate" };

    const agreement = (before.franchiseAgreements ?? []).find((candidate) => candidate.id === request.franchiseAgreementId);
    const franchise = before.franchises.find((candidate) => candidate.id === agreement?.franchiseId);
    if (!agreement || !franchise) return { outcome: "ignored", reason: "unknown_agreement" };

    // A completion for an agreement that is already executed is stale: never fetch or store anything for it.
    if (event.type === "completed" && agreement.status === "executed") return { outcome: "ignored", reason: "already_executed" };

    const signer = event.type === "signer.completed" ? findSignerForEvent(before, request.id, event.signerEmail) : undefined;
    if (event.type === "signer.completed" && !signer) throw new ESignEventError("The signer is not one we asked for this request.");

    const stored = event.type === "completed" ? await retrieveArtifacts(event, franchise, deps) : undefined;

    return await db.transaction(async (tx) => {
      if (!(await claimWebhookEvent(tx, { providerKey: PROVIDER_KEY, eventId: `${event.providerRequestId}:${event.eventId}`, eventType: event.type }))) return { outcome: "duplicate" as const };

      const data = await loadFranchiseData(tx);
      if (stored) for (const item of stored.references) await saveFileReference(tx, item);
      await recordSignatureProviderEvent(system.context, system.permissions, system.audit(tx), data, {
        eventId: event.eventId,
        requestId: request.id,
        eventType: event.type,
        signerId: signer?.id,
        signedAgreementArtifact: stored?.signed,
        completionCertificateArtifact: stored?.certificate,
        payload: { source: "esign_webhook", occurredAt: event.occurredAt ?? null }
      });
      const agreementNow = data.franchiseAgreements!.find((candidate) => candidate.id === request.franchiseAgreementId)!;
      await updateFranchiseAgreementState(tx, agreementNow);
      await syncSignatureRequestGraph(tx, data, request.id);
      return { outcome: "processed" as const };
    });
  } finally {
    await sql.end();
  }
}

async function retrieveArtifacts(
  event: ESignInboundEvent,
  franchise: { id: string; franchiseOrganisationId: string; primaryTerritoryId: string },
  deps: { fetch?: typeof fetch; providers?: FileProviders; hosts?: string[] }
) {
  const hosts = deps.hosts ?? allowedArtifactHosts();
  // Refuse the whole event before fetching anything if any address is not trusted.
  for (const artifact of event.artifacts ?? []) assertArtifactUrlAllowed(artifact.url, hosts);

  const references: Awaited<ReturnType<typeof storeDocumentFile>>[] = [];
  const build = async (kind: "signed_agreement" | "completion_certificate", label: string, fileName: string): Promise<FranchiseArtifactReference> => {
    const wanted = event.artifacts!.find((candidate) => candidate.kind === kind)!;
    const bytes = await fetchSignedArtifact(wanted.url, { hosts, fetch: deps.fetch });
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (wanted.sha256 && wanted.sha256 !== checksum) throw new ESignArtifactError("The document does not match the checksum the provider sent.");

    const reference = await storeDocumentFile(
      { franchise: { organisationId: franchise.franchiseOrganisationId, territoryId: franchise.primaryTerritoryId }, userId: "", fileName, contentType: "application/pdf", bytes },
      deps.providers ?? defaultFileProviders()
    );
    references.push(reference);
    return {
      id: randomUUID(),
      franchiseId: franchise.id,
      entityType: "franchise_agreement",
      entityId: "",
      category: kind,
      label,
      storageKey: reference.storageKey,
      contentType: "application/pdf",
      checksum,
      providerMetadata: { fileId: reference.id, provider: reference.providerKey, fileName, source: "esign" }
    };
  };

  const signed = await build("signed_agreement", "Signed franchise agreement", "signed-franchise-agreement.pdf");
  const certificate = await build("completion_certificate", "Completion certificate", "completion-certificate.pdf");
  return { signed, certificate, references };
}

export { DocumentFileError, ESignArtifactError, ESignEventError };
