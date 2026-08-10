import { auditActions } from "@raring2go/audit";
import { describe, expect, it } from "vitest";
import { createSession, revokeSession } from "./sessions";
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
});
