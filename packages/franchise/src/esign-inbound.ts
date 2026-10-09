import { createHmac, timingSafeEqual } from "node:crypto";
import type { AgreementSigner, FranchiseData } from "./types";

/**
 * The e-signature boundary, provider-neutral. Any e-sign provider (DocuSign, Adobe Sign, Dropbox Sign, ...) is
 * integrated by a thin translator that turns its callback into the event below and signs it with our shared secret;
 * nothing else in the system knows which provider is in use. See docs/ESIGN_PROVIDER_CONTRACT.md.
 */

export type ESignEventType = "signer.completed" | "completed" | "declined" | "expired" | "cancelled";

export type ESignArtifactKind = "signed_agreement" | "completion_certificate";

export type ESignInboundEvent = {
  /** The provider's id for this event. Redelivery of the same event carries the same id. */
  eventId: string;
  type: ESignEventType;
  /** The provider's id for the signing request, as returned when we sent it. */
  providerRequestId: string;
  /** Who signed (for signer.completed). Matched to the signer we asked, case-insensitively. */
  signerEmail?: string;
  occurredAt?: string;
  /** For `completed`: where to fetch the signed agreement and completion certificate. */
  artifacts?: Array<{ kind: ESignArtifactKind; url: string; sha256?: string }>;
};

const eventTypes = new Set<string>(["signer.completed", "completed", "declined", "expired", "cancelled"]);
const artifactKinds = new Set<string>(["signed_agreement", "completion_certificate"]);

export class ESignEventError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() !== "" && value.length <= max ? value.trim() : undefined);

/** Strict validation of the neutral event. Anything unexpected is refused, never coerced. */
export function parseESignEvent(raw: string): ESignInboundEvent {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ESignEventError("The event is not valid JSON.");
  }
  if (!isRecord(body)) throw new ESignEventError("The event must be a JSON object.");

  const eventId = text(body.eventId, 200);
  const providerRequestId = text(body.providerRequestId, 200);
  if (!eventId || !providerRequestId) throw new ESignEventError("eventId and providerRequestId are required.");
  if (typeof body.type !== "string" || !eventTypes.has(body.type)) throw new ESignEventError("Unknown event type.");

  const event: ESignInboundEvent = { eventId, providerRequestId, type: body.type as ESignEventType };
  if (body.signerEmail !== undefined) {
    const email = text(body.signerEmail, 254);
    if (!email || !email.includes("@")) throw new ESignEventError("signerEmail is not an email address.");
    event.signerEmail = email.toLowerCase();
  }
  if (body.occurredAt !== undefined) {
    const at = text(body.occurredAt, 40);
    if (!at || Number.isNaN(Date.parse(at))) throw new ESignEventError("occurredAt is not a date.");
    event.occurredAt = at;
  }
  if (body.artifacts !== undefined) {
    if (!Array.isArray(body.artifacts) || body.artifacts.length > 4) throw new ESignEventError("artifacts must be a short list.");
    event.artifacts = body.artifacts.map((entry) => {
      if (!isRecord(entry) || typeof entry.kind !== "string" || !artifactKinds.has(entry.kind)) throw new ESignEventError("An artifact has an unknown kind.");
      const url = text(entry.url, 2000);
      let parsed: URL | undefined;
      try {
        parsed = url ? new URL(url) : undefined;
      } catch {
        parsed = undefined;
      }
      if (!parsed || parsed.protocol !== "https:" || parsed.username || parsed.password) throw new ESignEventError("An artifact URL must be a plain https address.");
      const sha256 = entry.sha256 === undefined ? undefined : text(entry.sha256, 64);
      if (entry.sha256 !== undefined && (!sha256 || !/^[0-9a-f]{64}$/i.test(sha256))) throw new ESignEventError("An artifact sha256 must be 64 hex characters.");
      return { kind: entry.kind as ESignArtifactKind, url: parsed.toString(), ...(sha256 ? { sha256: sha256.toLowerCase() } : {}) };
    });
  }
  if (event.type === "completed") {
    const kinds = new Set((event.artifacts ?? []).map((artifact) => artifact.kind));
    if (!kinds.has("signed_agreement") || !kinds.has("completion_certificate")) throw new ESignEventError("A completed event needs both the signed agreement and the completion certificate.");
  }
  if (event.type === "signer.completed" && !event.signerEmail) throw new ESignEventError("A signer.completed event needs signerEmail.");
  return event;
}

export const E_SIGN_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Header format: `t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<raw body>">`. More than one `v1` is allowed so a secret
 * can be rotated: the sender signs with the new secret while we still accept the previous one. A timestamp outside the
 * tolerance is refused, so a captured request cannot be replayed later.
 */
export function verifyESignSignature(input: { header: string | null | undefined; body: string; secrets: string[]; nowSeconds?: number }): boolean {
  const secrets = input.secrets.filter(Boolean);
  if (!input.header || secrets.length === 0) return false;

  const parts = input.header.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0) return false;

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > E_SIGN_SIGNATURE_TOLERANCE_SECONDS) return false;

  return secrets.some((secret) => {
    const expected = createHmac("sha256", secret).update(`${timestamp}.${input.body}`).digest();
    return signatures.some((candidate) => {
      if (!/^[0-9a-f]{64}$/i.test(candidate)) return false;
      return timingSafeEqual(expected, Buffer.from(candidate, "hex"));
    });
  });
}

/** Signs a body the way a provider translator must. Used by tests and by the contract's reference snippet. */
export function signESignBody(secret: string, body: string, timestampSeconds = Math.floor(Date.now() / 1000)) {
  return `t=${timestampSeconds},v1=${createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex")}`;
}

/** The signer the event refers to, among the signers we asked for this request. */
export function findSignerForEvent(data: FranchiseData, requestId: string, email: string | undefined): AgreementSigner | undefined {
  if (!email) return undefined;
  return (data.signers ?? []).find((signer) => signer.signatureRequestId === requestId && !signer.deletedAt && signer.email.toLowerCase() === email.toLowerCase());
}

export function findRequestByProviderId(data: FranchiseData, providerRequestId: string) {
  return (data.signatureRequests ?? []).find((request) => request.providerRequestId === providerRequestId);
}
