import { randomUUID } from "node:crypto";
import { authInvitations, authSessions, authVerificationTokens, createDb, fixtureIds, memberships, userRoleAssignments, users } from "@raring2go/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDrizzleAuthRepository } from "./drizzle-repository";
import { acceptInvitation } from "./invitations";
import { consumePasswordlessSignIn, requestPasswordlessSignIn } from "./passwordless";
import { resolveWorkingContext } from "./context";
import { createSession, revokeSession } from "./sessions";
import { createMemoryAuditRecorder } from "./test-helpers";
import { hashToken } from "./tokens";

/** Real SQL for the identity store. `RUN_DB_TESTS=1 pnpm --filter @raring2go/auth test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("drizzle auth repository (postgres)", () => {
  const { db, sql } = createDb();
  const repository = createDrizzleAuthRepository(db);
  const audit = createMemoryAuditRecorder();
  const tag = randomUUID().slice(0, 8);
  const emails: string[] = [];
  const email = (label: string) => {
    const value = `itest-${label}-${tag}@example.com`;
    emails.push(value);
    return value;
  };

  afterAll(async () => {
    const found = emails.length ? await db.select({ id: users.id }).from(users).where(inArray(users.email, emails)) : [];
    const ids = found.map((row) => row.id);
    if (ids.length) {
      await db.delete(authSessions).where(inArray(authSessions.userId, ids));
      await db.delete(userRoleAssignments).where(inArray(userRoleAssignments.userId, ids));
      await db.delete(memberships).where(inArray(memberships.userId, ids));
      await db.delete(authInvitations).where(inArray(authInvitations.acceptedByUserId, ids));
    }
    if (emails.length) {
      await db.delete(authInvitations).where(inArray(authInvitations.email, emails));
      await db.delete(authVerificationTokens).where(inArray(authVerificationTokens.identifier, emails));
      await db.delete(users).where(inArray(users.email, emails));
    }
    await sql.end();
  });

  it("creates a user once even when two requests create the same person at the same time, and matches emails case-insensitively", async () => {
    const address = email("create");
    const [a, b] = await Promise.all([repository.createUser({ email: address, displayName: "A" }), repository.createUser({ email: address.toUpperCase(), displayName: "B" })]);
    expect(a.id).toBe(b.id);
    expect((await repository.findUserByEmail(address.toUpperCase()))?.id).toBe(a.id);
    expect((await repository.findUserById(a.id))?.email).toBe(address);
    expect(await repository.findUserById(randomUUID())).toBeNull();

    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, a.id));
    expect(await repository.findUserByEmail(address)).toBeNull();
    expect(await repository.findUserById(a.id)).toBeNull();
  });

  it("keeps one membership per user and organisation, and reactivates a disabled one", async () => {
    const user = await repository.createUser({ email: email("member") });
    const [m1, m2] = await Promise.all([
      repository.ensureMembership({ userId: user.id, organisationId: fixtureIds.organisations.franchise, status: "active" }),
      repository.ensureMembership({ userId: user.id, organisationId: fixtureIds.organisations.franchise, status: "active" })
    ]);
    expect(m1.id).toBe(m2.id);
    expect(await repository.findMembershipsForUser(user.id)).toHaveLength(1);

    await db.update(memberships).set({ status: "disabled" }).where(eq(memberships.userId, user.id));
    expect((await repository.ensureMembership({ userId: user.id, organisationId: fixtureIds.organisations.franchise, status: "active" })).status).toBe("active");
  });

  it("lets exactly one of two simultaneous uses of a sign-in link create a session, and creates new accounts without access, and rejects disabled ones", async () => {
    const address = email("signin");
    const user = await repository.createUser({ email: address });
    await requestPasswordlessSignIn(repository, audit, { email: address, token: `tok-${tag}-1` });

    const attempts = await Promise.allSettled([
      consumePasswordlessSignIn(repository, audit, { token: `tok-${tag}-1`, sessionToken: `sess-${tag}-a` }),
      consumePasswordlessSignIn(repository, audit, { token: `tok-${tag}-1`, sessionToken: `sess-${tag}-b` })
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, user.id))).toHaveLength(1);

    // A new address self-registers (parents), with no memberships and therefore no access.
    const newcomer = email("newcomer");
    await requestPasswordlessSignIn(repository, audit, { email: newcomer, token: `tok-${tag}-2` });
    const created = await consumePasswordlessSignIn(repository, audit, { token: `tok-${tag}-2`, sessionToken: `sess-${tag}-c` });
    expect(created.user.email).toBe(newcomer);
    expect(await repository.findMembershipsForUser(created.user.id)).toEqual([]);

    await db.update(users).set({ status: "disabled" }).where(eq(users.id, user.id));
    await requestPasswordlessSignIn(repository, audit, { email: address, token: `tok-${tag}-3` });
    await expect(consumePasswordlessSignIn(repository, audit, { token: `tok-${tag}-3`, sessionToken: `sess-${tag}-d` })).rejects.toThrow(/not available/);
  });

  it("round-trips a session, revokes it, and refuses a disabled account's live session", async () => {
    const user = await repository.createUser({ email: email("session") });
    await repository.ensureMembership({ userId: user.id, organisationId: fixtureIds.organisations.franchise, status: "active" });
    const session = await createSession(repository, audit, { userId: user.id, token: `s-${tag}`, expiresAt: new Date(Date.now() + 3_600_000) });
    const found = await repository.findSessionByTokenHash(hashToken(`s-${tag}`));
    expect(found).toMatchObject({ id: session.id, assuranceLevel: "standard" });
    await expect(resolveWorkingContext(repository, { session: found!, organisationId: fixtureIds.organisations.franchise })).resolves.toMatchObject({ userId: user.id });

    await db.update(users).set({ status: "disabled" }).where(eq(users.id, user.id));
    await expect(resolveWorkingContext(repository, { session: found!, organisationId: fixtureIds.organisations.franchise })).rejects.toThrow(/not active/);
    await db.update(users).set({ status: "active" }).where(eq(users.id, user.id));

    await revokeSession(repository, audit, { token: `s-${tag}` });
    const revoked = await repository.findSessionByTokenHash(hashToken(`s-${tag}`));
    await expect(resolveWorkingContext(repository, { session: revoked!, organisationId: fixtureIds.organisations.franchise })).rejects.toThrow(/revoked/);
  });

  it("accepts an invitation once under concurrency and grants the role scoped to the invitation", async () => {
    const address = email("invite");
    const [invitation] = await db
      .insert(authInvitations)
      .values({
        email: address,
        organisationId: fixtureIds.organisations.franchise,
        territoryId: fixtureIds.territories.suttonColdfield,
        roleId: fixtureIds.roles.franchisee,
        tokenHash: hashToken(`inv-${tag}`),
        expiresAt: new Date(Date.now() + 3_600_000)
      })
      .returning();

    const attempts = await Promise.allSettled([
      db.transaction(async (tx) => acceptInvitation(createDrizzleAuthRepository(tx as unknown as typeof db), audit, { token: `inv-${tag}`, email: address })),
      db.transaction(async (tx) => acceptInvitation(createDrizzleAuthRepository(tx as unknown as typeof db), audit, { token: `inv-${tag}`, email: address }))
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);

    const user = await repository.findUserByEmail(address);
    expect(user).not.toBeNull();
    const assignments = await db.select().from(userRoleAssignments).where(eq(userRoleAssignments.userId, user!.id));
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ roleId: fixtureIds.roles.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield });
    expect((await repository.findMembershipsForUser(user!.id)).map((m) => m.organisationId)).toEqual([fixtureIds.organisations.franchise]);
    expect((await db.select().from(authInvitations).where(eq(authInvitations.id, invitation!.id)))[0]).toMatchObject({ status: "accepted", acceptedByUserId: user!.id });
  });
});
