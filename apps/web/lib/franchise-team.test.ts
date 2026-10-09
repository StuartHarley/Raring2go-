import { randomUUID } from "node:crypto";
import { auditEvents, createDb, fixtureIds, franchises, memberships, userRoleAssignments, users } from "@raring2go/db";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { inviteFranchiseStaffAsActor, readFranchiseTeamAsActor, removeFranchiseStaffAsActor } from "./access-runtime";
import { withFinanceGuardsDisabled } from "./finance-test-support";
import { updateFranchiseFromInput } from "./franchise-runtime";

const franchiseId = "00000000-0000-4000-8000-000000000901";
const franchisee = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };

/** Real database: a franchise's team is managed through the runtime, and leaves with the franchise. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("franchise team runtime (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const userIds: string[] = [];

  afterAll(async () => {
    await db.update(franchises).set({ status: "active" }).where(eq(franchises.id, franchiseId));
    if (userIds.length) {
      await db.delete(userRoleAssignments).where(inArray(userRoleAssignments.userId, userIds));
      await db.delete(memberships).where(inArray(memberships.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await withFinanceGuardsDisabled(db, async () => {
      await db.delete(auditEvents).where(and(like(auditEvents.action, "franchise.team.%"), eq(auditEvents.actorUserId, hq.userId)));
    });
    await sql.end();
  });

  it("invites, lists and removes staff for the franchisee's own territory, and the team leaves when the franchise is suspended", async () => {
    const invited = await inviteFranchiseStaffAsActor(franchisee, { email: `team-rt-${tag}@example.com` });
    expect(invited.invitation).toMatchObject({ territoryId: franchisee.territoryId, status: "pending" });

    // A person on the team (as if they had accepted).
    const [member] = await db.insert(users).values({ email: `team-rt-member-${tag}@example.com`, displayName: "Member" }).returning();
    userIds.push(member!.id);
    await db.insert(memberships).values({ userId: member!.id, organisationId: franchisee.organisationId });
    await db.insert(userRoleAssignments).values({ userId: member!.id, roleId: fixtureIds.roles.franchiseStaff, organisationId: franchisee.organisationId, territoryId: franchisee.territoryId });

    const team = await readFranchiseTeamAsActor(franchisee);
    expect(team.staff.map((entry) => entry.userId)).toContain(member!.id);
    expect(team.invitations.some((entry) => entry.email === `team-rt-${tag}@example.com`)).toBe(true);

    await updateFranchiseFromInput(hq, franchiseId, { status: "suspended" });
    const after = await readFranchiseTeamAsActor(franchisee);
    expect(after.staff.map((entry) => entry.userId)).not.toContain(member!.id);
    expect(after.invitations).toHaveLength(0);

    const events = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "franchise.team.access_ended"), eq(auditEvents.actorUserId, hq.userId)));
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Reactivating does not bring anyone back: access must be granted afresh.
    await updateFranchiseFromInput(hq, franchiseId, { status: "active" });
    expect((await readFranchiseTeamAsActor(franchisee)).staff).toHaveLength(0);
  });

  it("refuses removal of someone who is not on the team", async () => {
    await expect(removeFranchiseStaffAsActor(franchisee, randomUUID())).rejects.toThrow(/not on your team/);
  });
});
