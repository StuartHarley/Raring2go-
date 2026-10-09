import { auditActions } from "@raring2go/audit";
import { describe, expect, it } from "vitest";
import { createSession, revokeAllSessions, revokeSession } from "./sessions";
import { createMemoryAuditRecorder, createMemoryAuthRepository } from "./test-helpers";
import { hashToken } from "./tokens";

describe("sessions", () => {
  it("creates sessions with assurance metadata and audit events", async () => {
    const repository = createMemoryAuthRepository();
    const audit = createMemoryAuditRecorder();

    const session = await createSession(repository, audit, {
      userId: "user_1",
      token: "session-token",
      assuranceLevel: "mfa",
      expiresAt: new Date("2026-08-11T00:00:00.000Z")
    });

    expect(session.sessionTokenHash).toBe(hashToken("session-token"));
    expect(session.assuranceLevel).toBe("mfa");
    expect(audit.events[0]).toMatchObject({
      action: auditActions.authSignIn,
      metadata: {
        assuranceLevel: "mfa"
      }
    });
  });

  it("revokes sessions and writes an audit event", async () => {
    const repository = createMemoryAuthRepository({
      sessions: [
        {
          id: "session_1",
          userId: "user_1",
          sessionTokenHash: hashToken("session-token"),
          assuranceLevel: "standard",
          expiresAt: new Date("2026-08-11T00:00:00.000Z")
        }
      ]
    });
    const audit = createMemoryAuditRecorder();

    await revokeSession(repository, audit, {
      token: "session-token",
      now: new Date("2026-08-10T00:00:00.000Z")
    });

    expect(repository.sessions[0]?.revokedAt).toEqual(
      new Date("2026-08-10T00:00:00.000Z")
    );
    expect(audit.events[0]).toMatchObject({
      action: auditActions.authSessionRevoke,
      entity: {
        type: "auth_session",
        id: "session_1"
      }
    });
  });

  describe("revokeAllSessions (account recovery)", () => {
    const now = new Date("2026-08-10T00:00:00.000Z");
    const later = new Date("2026-09-10T00:00:00.000Z");
    const session = (id: string, userId: string, token: string, extra: Record<string, unknown> = {}) => ({
      id, userId, sessionTokenHash: hashToken(token), assuranceLevel: "standard" as const, expiresAt: later, ...extra
    });

    it("ends every live session of the signed-in user and nobody else's, and audits it", async () => {
      const repository = createMemoryAuthRepository({
        sessions: [
          session("s1", "user_1", "t1"),
          session("s2", "user_1", "t2"),
          session("s3", "user_1", "t3", { revokedAt: new Date("2026-08-01T00:00:00.000Z") }),
          session("s4", "user_2", "t4")
        ]
      });
      const audit = createMemoryAuditRecorder();

      await expect(revokeAllSessions(repository, audit, { token: "t1", now })).resolves.toEqual({ sessionsEnded: 2 });

      expect(repository.sessions.map((candidate) => [candidate.id, Boolean(candidate.revokedAt)])).toEqual([["s1", true], ["s2", true], ["s3", true], ["s4", false]]);
      // Already-revoked sessions keep their original revoke time.
      expect(repository.sessions[2]?.revokedAt).toEqual(new Date("2026-08-01T00:00:00.000Z"));
      expect(audit.events[0]).toMatchObject({ action: auditActions.authSessionRevokeAll, entity: { type: "user", id: "user_1" } });
    });

    it("refuses an unknown, revoked or expired session, so it cannot be used to end someone else's", async () => {
      const repository = createMemoryAuthRepository({
        sessions: [
          session("s1", "user_1", "revoked", { revokedAt: new Date("2026-08-01T00:00:00.000Z") }),
          session("s2", "user_1", "expired", { expiresAt: new Date("2026-08-09T00:00:00.000Z") }),
          session("s3", "user_2", "live")
        ]
      });
      const audit = createMemoryAuditRecorder();

      for (const token of ["nope", "revoked", "expired"]) {
        await expect(revokeAllSessions(repository, audit, { token, now })).rejects.toThrow("Session was not found.");
      }
      expect(repository.sessions[2]?.revokedAt).toBeUndefined();
      expect(audit.events).toHaveLength(0);
    });
  });
});
