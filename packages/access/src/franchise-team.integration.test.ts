import { randomUUID } from "node:crypto";
import { acceptInvitation, createDrizzleAuthRepository, createMemoryAuditRecorder } from "@raring2go/auth";
import { authInvitations, createDb, fixtureIds, fixturePermissionData, memberships, userRoleAssignments, users } from "@raring2go/db";
import { evaluatePermission, loadPermissionData } from "@raring2go/permissions";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { assertCanAssignRole } from "./guards";
import { DEFAULT_SEAT_LIMIT, endFranchiseStaffAccess, inviteFranchiseStaff, readFranchiseTeam, removeFranchiseStaff, revokeFranchiseStaffInvitation } from "./franchise-team";
import { createDrizzleAccessStore } from "./repository";
import { AccessDeniedError, AccessInputError, AccessStateError } from "./service";

const sutton = fixtureIds.territories.suttonColdfield;
const solihull = fixtureIds.territories.solihull;
const franchiseOrg = fixtureIds.organisations.franchise;
const staffRole = fixtureIds.roles.franchiseStaff;

describe("the Franchise Staff role (no database)", () => {
  const data = fixturePermissionData();
  const grants = data.rolePermissions.filter((grant) => grant.roleId === staffRole);
  const has = (module: string, action: string) => grants.some((grant) => grant.permission.module === module && grant.permission.action === action);

  it("stays within the franchisee's own territory and below the franchisee's own access", () => {
    expect(grants.length).toBeGreaterThan(20);
    expect(grants.every((grant) => grant.scope === "own_territory")).toBe(true);
    // A franchisee holds every capability the role carries, so the escalation guard lets them delegate it.
    expect(() => assertCanAssignRole(data, fixtureIds.users.franchisee, staffRole, { organisationId: franchiseOrg, territoryId: sutton })).not.toThrow();
  });

  it("can do the approved work", () => {
    for (const [module, action] of [["advertiser", "view"], ["advertiser", "edit"], ["advertiser.opportunity", "edit"], ["advertiser.proposal", "create"], ["content", "create"], ["content", "edit"], ["marketing.email", "create"], ["social", "create"], ["franchise.compliance", "view"]]) {
      expect(has(module!, action!), `${module}.${action}`).toBe(true);
    }
  });

  it("cannot send, book, approve, invoice, publish, see money, or manage people", () => {
    for (const [module, action] of [
      ["advertiser.proposal", "send"], ["advertiser.booking", "accept"], ["advertiser.invoice", "create"], ["advertiser.invoice", "issue"], ["advertiser.payment", "record"], ["advertiser.credit", "create"], ["advertiser.finance", "view"],
      ["finance.royalty_statement", "view"], ["marketing.email", "approve"], ["marketing.email", "schedule"], ["marketing.email", "send"], ["social", "approve"], ["social", "schedule"], ["social", "publish"],
      ["content", "approve"], ["edition", "approve"], ["franchise.agreement", "view"], ["franchise.document", "view"], ["roles", "view"], ["roles", "assign"], ["roles", "invite"], ["franchise.team", "view"], ["franchise.team", "manage"], ["system.administer", "administer"]
    ]) {
      expect(has(module!, action!), `${module}.${action}`).toBe(false);
    }
  });

  it("keeps sending a proposal separate from drafting it, so only the franchisee can send", () => {
    expect(evaluatePermission({ userId: fixtureIds.users.franchisee, module: "advertiser.proposal", action: "send", resource: { organisationId: franchiseOrg, territoryId: sutton } }, data).allowed).toBe(true);
  });
});

/** Real database: a franchisee runs their own team, safely. `RUN_DB_TESTS=1 pnpm --filter @raring2go/access test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("franchise team (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  type Actor = { userId: string; organisationId?: string; territoryId?: string };
  const franchisee: Actor = { userId: fixtureIds.users.franchisee, organisationId: franchiseOrg, territoryId: sutton };
  const events: Array<{ action: string; metadata?: unknown; scope?: unknown }> = [];
  const audit = { record: async (input: { action: string; metadata?: unknown; scope?: unknown }) => void events.push(input) };
  const userIds: string[] = [];
  const emails: string[] = [];

  const run = async <T>(_actor: Actor, work: (ctx: { permissions: Awaited<ReturnType<typeof loadPermissionData>>; store: ReturnType<typeof createDrizzleAccessStore> }) => Promise<T>) => {
    const permissions = await loadPermissionData(db);
    return db.transaction(async (tx) => work({ permissions, store: createDrizzleAccessStore(tx as unknown as typeof db) }));
  };
  const invite = (label: string, options: { seatLimit?: number; roleId?: string | null; actor?: Actor } = {}) => {
    const email = `team-${label}-${tag}@example.com`;
    emails.push(email);
    return run(options.actor ?? franchisee, ({ permissions, store }) => inviteFranchiseStaff(options.actor ?? franchisee, permissions, audit, store, { email, roleId: options.roleId }, new Date(), { seatLimit: options.seatLimit }));
  };
  const accept = async (token: string, email: string) => {
    const result = await db.transaction(async (tx) => acceptInvitation(createDrizzleAuthRepository(tx as unknown as typeof db), createMemoryAuditRecorder(), { token, email }));
    userIds.push(result.user.id);
    return result.user.id;
  };
  const allowed = async (userId: string, module: string, action: string, territoryId: string) =>
    evaluatePermission({ userId, module, action, resource: { organisationId: franchiseOrg, territoryId } }, await loadPermissionData(db)).allowed;

  afterAll(async () => {
    if (userIds.length) {
      await db.delete(userRoleAssignments).where(inArray(userRoleAssignments.userId, userIds));
      await db.delete(memberships).where(inArray(memberships.userId, userIds));
    }
    await db.delete(authInvitations).where(like(authInvitations.email, `team-%-${tag}@example.com`));
    await db.delete(users).where(like(users.email, `team-%-${tag}@example.com`));
    await db.delete(users).where(like(users.email, `itest-%-${tag}@example.com`));
    await sql.end();
  });

  it("lets a franchisee invite staff for the staff role only, scoped to their own territory, and audits it", async () => {
    const { invitation, token } = await invite("one");
    expect(invitation).toMatchObject({ organisationId: franchiseOrg, territoryId: sutton, roleId: staffRole, status: "pending" });
    expect(token.length).toBeGreaterThan(20);
    expect(events.at(-1)).toMatchObject({ action: "franchise.team.invite", scope: { organisationId: franchiseOrg, territoryId: sutton } });
    expect(JSON.stringify(events)).not.toContain(`team-one-${tag}@example.com`);

    const team = await run(franchisee, ({ permissions, store }) => readFranchiseTeam(franchisee, permissions, store));
    expect(team.invitations.map((entry) => entry.id)).toContain(invitation.id);
    expect(team.canManage).toBe(true);
    expect(team.seats.limit).toBe(DEFAULT_SEAT_LIMIT);
  });

  it("refuses any role that is not delegable, so a franchisee can never create another franchisee or a head office user", async () => {
    for (const roleId of [fixtureIds.roles.franchisee, fixtureIds.roles.hqAdmin, fixtureIds.roles.superAdmin, fixtureIds.roles.advertiser]) {
      await expect(invite("bad", { roleId })).rejects.toBeInstanceOf(AccessDeniedError);
    }
    expect((await db.select().from(authInvitations).where(like(authInvitations.email, `team-bad-${tag}@example.com`))).length).toBe(0);
  });

  it("gives an accepted invitee exactly the staff access in the franchise's territory, and nothing in another territory", async () => {
    const { token } = await invite("access");
    const staff = await accept(token, `team-access-${tag}@example.com`);

    for (const [module, action] of [["advertiser", "view"], ["advertiser", "edit"], ["advertiser.proposal", "create"], ["content", "create"], ["social", "create"], ["marketing.email", "create"]]) {
      expect(await allowed(staff, module!, action!, sutton), `${module}.${action} in Sutton`).toBe(true);
      expect(await allowed(staff, module!, action!, solihull), `${module}.${action} in Solihull`).toBe(false);
    }
    for (const [module, action] of [["advertiser.proposal", "send"], ["advertiser.booking", "accept"], ["advertiser.invoice", "issue"], ["social", "publish"], ["marketing.email", "send"], ["roles", "assign"], ["franchise.team", "manage"], ["franchise.agreement", "view"]]) {
      expect(await allowed(staff, module!, action!, sutton), `${module}.${action}`).toBe(false);
    }

    // Staff cannot run the team.
    const staffActor = { userId: staff, organisationId: franchiseOrg, territoryId: sutton };
    await expect(run(staffActor, ({ permissions, store }) => readFranchiseTeam(staffActor, permissions, store))).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(invite("fromstaff", { actor: staffActor })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("enforces the seat limit, but lets a pending invitation be re-sent without taking another seat", async () => {
    const before = await run(franchisee, ({ permissions, store }) => readFranchiseTeam(franchisee, permissions, store));
    const limit = before.seats.used + 1;
    await invite("seat1", { seatLimit: limit });
    await expect(invite("seat2", { seatLimit: limit })).rejects.toThrow(/seat limit/);
    await expect(invite("seat1", { seatLimit: limit })).resolves.toBeDefined();
  });

  it("removes a person from the team, ends their access, and withdraws a pending invitation", async () => {
    const { token } = await invite("leaver");
    const leaver = await accept(token, `team-leaver-${tag}@example.com`);
    expect(await allowed(leaver, "advertiser", "view", sutton)).toBe(true);

    const team = await run(franchisee, ({ permissions, store }) => readFranchiseTeam(franchisee, permissions, store));
    const assignment = team.staff.find((entry) => entry.userId === leaver)!;
    await run(franchisee, ({ permissions, store }) => removeFranchiseStaff(franchisee, permissions, audit, store, assignment.id));
    expect(await allowed(leaver, "advertiser", "view", sutton)).toBe(false);
    expect(events.at(-1)).toMatchObject({ action: "franchise.team.remove" });
    await expect(run(franchisee, ({ permissions, store }) => removeFranchiseStaff(franchisee, permissions, audit, store, assignment.id))).rejects.toBeInstanceOf(AccessStateError);

    const pending = await invite("pending");
    await run(franchisee, ({ permissions, store }) => revokeFranchiseStaffInvitation(franchisee, permissions, audit, store, pending.invitation.id));
    await expect(run(franchisee, ({ permissions, store }) => revokeFranchiseStaffInvitation(franchisee, permissions, audit, store, pending.invitation.id))).rejects.toBeInstanceOf(AccessStateError);
  });

  it("will not let a franchisee touch another franchise's team, or anyone who is not delegable staff", async () => {
    const [otherUser] = await db.insert(users).values({ email: `itest-other-${tag}@example.com`, displayName: "Other" }).returning();
    userIds.push(otherUser!.id);
    await db.insert(memberships).values({ userId: otherUser!.id, organisationId: fixtureIds.organisations.hq });
    // Staff of a different organisation, even in the same territory, are not this franchisee's team.
    const [otherStaff] = await db.insert(userRoleAssignments).values({ userId: otherUser!.id, roleId: staffRole, organisationId: fixtureIds.organisations.hq, territoryId: sutton }).returning();
    // Another franchisee-level assignment in the franchisee's own territory is not "staff" either.
    const [peer] = await db.insert(users).values({ email: `itest-peer-${tag}@example.com`, displayName: "Peer" }).returning();
    userIds.push(peer!.id);
    await db.insert(memberships).values({ userId: peer!.id, organisationId: franchiseOrg });
    const [peerAssignment] = await db.insert(userRoleAssignments).values({ userId: peer!.id, roleId: fixtureIds.roles.franchisee, organisationId: franchiseOrg, territoryId: sutton }).returning();

    for (const id of [otherStaff!.id, peerAssignment!.id]) {
      await expect(run(franchisee, ({ permissions, store }) => removeFranchiseStaff(franchisee, permissions, audit, store, id))).rejects.toThrow(/not on your team/);
    }
    expect(await allowed(peer!.id, "advertiser", "view", sutton)).toBe(true);

    // The team view never lists them either.
    const team = await run(franchisee, ({ permissions, store }) => readFranchiseTeam(franchisee, permissions, store));
    expect(team.staff.map((entry) => entry.userId)).not.toContain(otherUser!.id);
    expect(team.staff.map((entry) => entry.userId)).not.toContain(peer!.id);

    // And a franchisee cannot act for a territory that is not theirs.
    const foreign: Actor = { userId: fixtureIds.users.franchisee, organisationId: franchiseOrg, territoryId: solihull };
    await expect(run(foreign, ({ permissions, store }) => readFranchiseTeam(foreign, permissions, store))).rejects.toBeInstanceOf(AccessInputError);
    const noTerritory: Actor = { userId: franchisee.userId, organisationId: franchiseOrg };
    await expect(run(noTerritory, ({ permissions, store }) => readFranchiseTeam(noTerritory, permissions, store))).rejects.toBeInstanceOf(AccessInputError);
  });

  it("ends the whole team's access at once when the franchise is suspended or leaves", async () => {
    const [a, b] = [await invite("endA"), await invite("endB")];
    const staffA = await accept(a.token, `team-endA-${tag}@example.com`);
    expect(await allowed(staffA, "advertiser", "view", sutton)).toBe(true);

    const result = await db.transaction(async (tx) =>
      endFranchiseStaffAccess(audit, createDrizzleAccessStore(tx as unknown as typeof db), { organisationId: franchiseOrg, territoryId: sutton }, "franchise suspended", { type: "automation", automationId: "franchise.status" })
    );
    expect(result.peopleEnded).toBeGreaterThanOrEqual(1);
    expect(result.invitationsWithdrawn).toBeGreaterThanOrEqual(1);
    expect(await allowed(staffA, "advertiser", "view", sutton)).toBe(false);
    const invitationB = (await db.select().from(authInvitations).where(eq(authInvitations.id, b.invitation.id)))[0]!;
    expect(invitationB.status).toBe("revoked");
    expect(events.at(-1)).toMatchObject({ action: "franchise.team.access_ended", metadata: { reason: "franchise suspended" } });
    // The franchisee's own access is not touched.
    expect(await allowed(fixtureIds.users.franchisee, "advertiser", "view", sutton)).toBe(true);
  });
});
