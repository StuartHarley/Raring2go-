import { describe, expect, it } from "vitest";
import { ESignEventError, E_SIGN_SIGNATURE_TOLERANCE_SECONDS, findRequestByProviderId, findSignerForEvent, parseESignEvent, signESignBody, verifyESignSignature } from "./esign-inbound";
import type { FranchiseData } from "./types";

const completed = {
  eventId: "evt_1", type: "completed", providerRequestId: "req_9",
  artifacts: [
    { kind: "signed_agreement", url: "https://files.provider.example/a.pdf", sha256: "a".repeat(64) },
    { kind: "completion_certificate", url: "https://files.provider.example/c.pdf" }
  ]
};

describe("parseESignEvent", () => {
  it("accepts well-formed events and normalises them", () => {
    expect(parseESignEvent(JSON.stringify({ eventId: "e1", type: "signer.completed", providerRequestId: "r1", signerEmail: " Pat@Example.TEST ", occurredAt: "2026-10-09T10:00:00Z" }))).toEqual({ eventId: "e1", type: "signer.completed", providerRequestId: "r1", signerEmail: "pat@example.test", occurredAt: "2026-10-09T10:00:00Z" });
    expect(parseESignEvent(JSON.stringify(completed)).artifacts).toHaveLength(2);
    expect(parseESignEvent(JSON.stringify({ eventId: "e2", type: "declined", providerRequestId: "r1" })).type).toBe("declined");
  });

  it("rejects anything unexpected instead of coercing it", () => {
    const bad = (value: unknown) => expect(() => parseESignEvent(typeof value === "string" ? value : JSON.stringify(value))).toThrow(ESignEventError);
    bad("not json");
    bad([]);
    bad({ type: "completed" });
    bad({ eventId: "e", providerRequestId: "r", type: "something_else" });
    bad({ eventId: "e", providerRequestId: "r", type: "signer.completed" });
    bad({ eventId: "e", providerRequestId: "r", type: "signer.completed", signerEmail: "nope" });
    bad({ eventId: "e".repeat(300), providerRequestId: "r", type: "declined" });
    bad({ eventId: "e", providerRequestId: "r", type: "declined", occurredAt: "yesterday" });
  });

  it("requires both artefacts to complete, and only plain https URLs with real hashes", () => {
    const withArtifacts = (artifacts: unknown) => JSON.stringify({ ...completed, artifacts });
    expect(() => parseESignEvent(withArtifacts([completed.artifacts[0]]))).toThrow(/both/);
    for (const url of ["http://x.example/a.pdf", "ftp://x.example/a.pdf", "file:///etc/passwd", "https://user:pw@x.example/a.pdf", "javascript:alert(1)", "not a url"]) {
      expect(() => parseESignEvent(withArtifacts([{ kind: "signed_agreement", url }, completed.artifacts[1]])), url).toThrow(ESignEventError);
    }
    expect(() => parseESignEvent(withArtifacts([{ ...completed.artifacts[0], sha256: "xyz" }, completed.artifacts[1]]))).toThrow(/sha256/);
    expect(() => parseESignEvent(withArtifacts([{ kind: "mystery", url: "https://a.example/x" }, completed.artifacts[1]]))).toThrow(/unknown kind/);
  });
});

describe("verifyESignSignature", () => {
  const body = JSON.stringify(completed);
  const now = 1_790_000_000;

  it("accepts a correctly signed, recent body", () => {
    expect(verifyESignSignature({ header: signESignBody("s3cret", body, now), body, secrets: ["s3cret"], nowSeconds: now })).toBe(true);
  });

  it("rejects a wrong secret, a changed body, a missing header or no configured secret", () => {
    const header = signESignBody("s3cret", body, now);
    expect(verifyESignSignature({ header, body, secrets: ["other"], nowSeconds: now })).toBe(false);
    expect(verifyESignSignature({ header, body: body + " ", secrets: ["s3cret"], nowSeconds: now })).toBe(false);
    expect(verifyESignSignature({ header: null, body, secrets: ["s3cret"], nowSeconds: now })).toBe(false);
    expect(verifyESignSignature({ header, body, secrets: [], nowSeconds: now })).toBe(false);
    expect(verifyESignSignature({ header, body, secrets: [""], nowSeconds: now })).toBe(false);
  });

  it("rejects an old or future timestamp, so a captured request cannot be replayed", () => {
    const header = signESignBody("s3cret", body, now);
    expect(verifyESignSignature({ header, body, secrets: ["s3cret"], nowSeconds: now + E_SIGN_SIGNATURE_TOLERANCE_SECONDS })).toBe(true);
    expect(verifyESignSignature({ header, body, secrets: ["s3cret"], nowSeconds: now + E_SIGN_SIGNATURE_TOLERANCE_SECONDS + 1 })).toBe(false);
    expect(verifyESignSignature({ header, body, secrets: ["s3cret"], nowSeconds: now - E_SIGN_SIGNATURE_TOLERANCE_SECONDS - 1 })).toBe(false);
  });

  it("supports secret rotation and ignores malformed signature parts", () => {
    const header = signESignBody("new-secret", body, now);
    expect(verifyESignSignature({ header, body, secrets: ["old-secret", "new-secret"], nowSeconds: now })).toBe(true);
    expect(verifyESignSignature({ header: `${header},v1=zzzz`, body, secrets: ["new-secret"], nowSeconds: now })).toBe(true);
    expect(verifyESignSignature({ header: `t=${now},v1=nothex`, body, secrets: ["new-secret"], nowSeconds: now })).toBe(false);
    expect(verifyESignSignature({ header: `v1=${"a".repeat(64)}`, body, secrets: ["new-secret"], nowSeconds: now })).toBe(false);
    expect(verifyESignSignature({ header: `t=abc,v1=${"a".repeat(64)}`, body, secrets: ["new-secret"], nowSeconds: now })).toBe(false);
  });
});

describe("lookups", () => {
  const data = {
    signatureRequests: [{ id: "r1", providerRequestId: "req_9" }, { id: "r2", providerRequestId: "req_other" }],
    signers: [{ id: "s1", signatureRequestId: "r1", email: "Pat@Example.test" }, { id: "s2", signatureRequestId: "r2", email: "pat@example.test" }]
  } as unknown as FranchiseData;

  it("finds the request by the provider's id and the signer within that request only", () => {
    expect(findRequestByProviderId(data, "req_9")?.id).toBe("r1");
    expect(findRequestByProviderId(data, "nope")).toBeUndefined();
    expect(findSignerForEvent(data, "r1", "PAT@example.test")?.id).toBe("s1");
    expect(findSignerForEvent(data, "r1", "stranger@example.test")).toBeUndefined();
    expect(findSignerForEvent(data, "r1", undefined)).toBeUndefined();
  });
});
