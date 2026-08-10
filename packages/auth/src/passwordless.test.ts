import { auditActions } from "@raring2go/audit";
import { describe, expect, it } from "vitest";
import {
  consumePasswordlessSignIn,
  requestPasswordlessSignIn
} from "./passwordless";
import { createMemoryAuditRecorder, createMemoryAuthRepository } from "./test-helpers";

describe("passwordless sign-in", () => {
  it("creates a provider-neutral sign-in token and audit event", async () => {
    const repository = createMemoryAuthRepository();
    const audit = createMemoryAuditRecorder();

    await expect(
      requestPasswordlessSignIn(repository, audit, {
        email: " STUART@example.com ",
        token: "magic-token",
        now: new Date("2026-08-10T12:00:00.000Z")
      })
    ).resolves.toMatchObject({
      email: "stuart@example.com",
      token: "magic-token"
    });

    expect(repository.verificationTokens).toHaveLength(1);
    expect(audit.events).toMatchObject([
      {
        action: auditActions.authEmailVerify
      }
    ]);
  });

  it("consumes a valid token once and creates a real session", async () => {
    const repository = createMemoryAuthRepository();
    const audit = createMemoryAuditRecorder();

    await requestPasswordlessSignIn(repository, audit, {
      email: "user@example.com",
      token: "magic-token",
      now: new Date("2026-08-10T12:00:00.000Z")
    });

    await expect(
      consumePasswordlessSignIn(repository, audit, {
        token: "magic-token",
        sessionToken: "session-token",
        now: new Date("2026-08-10T12:01:00.000Z")
      })
    ).resolves.toMatchObject({
      user: {
        email: "user@example.com"
      },
      session: {
        assuranceLevel: "standard"
      }
    });

    await expect(
      consumePasswordlessSignIn(repository, audit, {
        token: "magic-token",
        sessionToken: "another-session",
        now: new Date("2026-08-10T12:02:00.000Z")
      })
    ).rejects.toThrow("already been used");
  });

  it("rejects expired tokens", async () => {
    const repository = createMemoryAuthRepository();
    const audit = createMemoryAuditRecorder();

    await requestPasswordlessSignIn(repository, audit, {
      email: "user@example.com",
      token: "expired-token",
      now: new Date("2026-08-10T12:00:00.000Z"),
      ttlMs: 1
    });

    await expect(
      consumePasswordlessSignIn(repository, audit, {
        token: "expired-token",
        sessionToken: "session-token",
        now: new Date("2026-08-10T12:01:00.000Z")
      })
    ).rejects.toThrow("expired");
  });
});
