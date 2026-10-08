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
    const repository = createMemoryAuthRepository({ users: [{ id: "user_1", email: "user@example.com", status: "active" }] });
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

  it("creates an account on first sign-in (parents self-register); it holds no access until granted", async () => {
    const repository = createMemoryAuthRepository();
    const audit = createMemoryAuditRecorder();
    await requestPasswordlessSignIn(repository, audit, { email: "newparent@example.com", token: "tok", now: new Date("2026-08-10T12:00:00.000Z") });

    const result = await consumePasswordlessSignIn(repository, audit, { token: "tok", sessionToken: "s", now: new Date("2026-08-10T12:01:00.000Z") });
    expect(result.user.email).toBe("newparent@example.com");
    expect(repository.memberships).toHaveLength(0);
  });

  it("refuses a disabled account even with a valid link", async () => {
    const repository = createMemoryAuthRepository({ users: [{ id: "user_1", email: "user@example.com", status: "disabled" }] });
    const audit = createMemoryAuditRecorder();
    await requestPasswordlessSignIn(repository, audit, { email: "user@example.com", token: "tok", now: new Date("2026-08-10T12:00:00.000Z") });

    await expect(consumePasswordlessSignIn(repository, audit, { token: "tok", sessionToken: "s", now: new Date("2026-08-10T12:01:00.000Z") })).rejects.toThrow(/not available/);
    expect(repository.sessions).toHaveLength(0);
  });

  it("lets only one of two simultaneous uses of a link create a session", async () => {
    const repository = createMemoryAuthRepository({ users: [{ id: "user_1", email: "user@example.com", status: "active" }] });
    const audit = createMemoryAuditRecorder();
    await requestPasswordlessSignIn(repository, audit, { email: "user@example.com", token: "tok", now: new Date("2026-08-10T12:00:00.000Z") });

    const attempts = await Promise.allSettled([
      consumePasswordlessSignIn(repository, audit, { token: "tok", sessionToken: "a", now: new Date("2026-08-10T12:01:00.000Z") }),
      consumePasswordlessSignIn(repository, audit, { token: "tok", sessionToken: "b", now: new Date("2026-08-10T12:01:00.000Z") })
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(repository.sessions).toHaveLength(1);
  });
});
