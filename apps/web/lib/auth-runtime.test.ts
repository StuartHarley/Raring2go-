import { auditActions } from "@raring2go/audit";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createFixtureIdentity,
  requestSignIn,
  setIdentityForTests,
  safeReturnTo,
  signOut,
  verifySignIn
} from "./auth-runtime";

describe("auth runtime", () => {
  const identity = createFixtureIdentity();
  beforeEach(() => setIdentityForTests(identity));

  it("allows only safe internal application and public area return paths", () => {
    expect(safeReturnTo("/app/territory?x=1")).toBe("/app/territory?x=1");
    expect(safeReturnTo("/areas/sutton-coldfield/saved")).toBe("/areas/sutton-coldfield/saved");
    expect(safeReturnTo("https://evil.example/app")).toBe("/app");
    expect(safeReturnTo("//evil.example/app")).toBe("/app");
    expect(safeReturnTo("/admin")).toBe("/app");
  });

  it("runs sign-in request, session creation and sign-out audit events", async () => {
    const token = `runtime-token-${crypto.randomUUID()}`;
    const sessionToken = `runtime-session-${crypto.randomUUID()}`;
    const startCount = identity.audit.events.length;

    await requestSignIn({
      email: "superadmin@example.raring2go.test",
      token,
      returnTo: "/app"
    });

    await verifySignIn({
      token,
      sessionToken
    });

    await signOut({
      sessionToken
    });

    const actions = identity.audit.events
      .slice(startCount)
      .map((event: { action: string }) => event.action);

    expect(actions).toEqual(
      expect.arrayContaining([
        auditActions.authEmailVerify,
        auditActions.authSignIn,
        auditActions.authSessionRevoke
      ])
    );
  });
});
