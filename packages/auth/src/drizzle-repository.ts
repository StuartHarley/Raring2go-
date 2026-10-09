import {
  authInvitations,
  authSessions,
  authVerificationTokens,
  memberships,
  territories,
  userRoleAssignments,
  users
} from "@raring2go/db";
import type { createDb } from "@raring2go/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { AuthInvitation, AuthRepository, AuthSession, AuthTokenRepository } from "./types";

type Db = ReturnType<typeof createDb>["db"];

/**
 * Postgres-backed identity: users, memberships, sessions, sign-in tokens and invitations. Everything
 * that must happen at most once (using a sign-in link, accepting an invitation, creating a user or
 * membership) is a single conditional statement, so concurrent requests on different serverless
 * instances cannot both win. Emails are matched case-insensitively and soft-deleted users do not exist.
 */
const toSession = (row: typeof authSessions.$inferSelect): AuthSession => ({ ...row, assuranceLevel: row.assuranceLevel === "mfa" ? "mfa" : "standard" });

export function createDrizzleAuthRepository(db: Db): AuthRepository & AuthTokenRepository {
  const liveUserByEmail = (email: string) => and(sql`lower(${users.email}) = ${email.toLowerCase()}`, isNull(users.deletedAt));

  return {
    async findUserByEmail(email) {
      const [user] = await db.select().from(users).where(liveUserByEmail(email)).limit(1);
      return user ?? null;
    },

    async findUserById(userId) {
      const [user] = await db.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1);
      return user ?? null;
    },

    async createUser(input) {
      // Two requests creating the same person race on the unique email; the loser reads the winner's row.
      const [created] = await db
        .insert(users)
        .values({ email: input.email.toLowerCase(), displayName: input.displayName })
        .onConflictDoNothing()
        .returning();
      if (created) return created;

      const [existing] = await db.select().from(users).where(liveUserByEmail(input.email)).limit(1);
      if (!existing) throw new Error("User was not created.");
      return existing;
    },

    async findMembershipsForUser(userId) {
      return db.select().from(memberships).where(eq(memberships.userId, userId)).orderBy(asc(memberships.createdAt), asc(memberships.id));
    },

    async findTerritoryById(territoryId) {
      const [territory] = await db.select().from(territories).where(and(eq(territories.id, territoryId), isNull(territories.deletedAt))).limit(1);
      return territory ?? null;
    },

    async findInvitationByTokenHash(tokenHash): Promise<AuthInvitation | null> {
      const [invitation] = await db.select().from(authInvitations).where(eq(authInvitations.tokenHash, tokenHash)).limit(1);
      return invitation ?? null;
    },

    async markInvitationAccepted(input) {
      const claimed = await db
        .update(authInvitations)
        .set({ status: "accepted", acceptedByUserId: input.userId, acceptedAt: input.acceptedAt, updatedAt: input.acceptedAt })
        .where(and(eq(authInvitations.id, input.invitationId), eq(authInvitations.status, "pending")))
        .returning({ id: authInvitations.id });
      return claimed.length === 1;
    },

    async ensureMembership(input) {
      const [created] = await db
        .insert(memberships)
        .values({ userId: input.userId, organisationId: input.organisationId, status: input.status })
        .onConflictDoNothing()
        .returning();
      if (created) return created;

      // Already a member: make sure the membership is active (an earlier one may have been disabled).
      const [existing] = await db
        .update(memberships)
        .set({ status: input.status, updatedAt: new Date() })
        .where(and(eq(memberships.userId, input.userId), eq(memberships.organisationId, input.organisationId)))
        .returning();
      if (!existing) throw new Error("Membership was not created.");
      return existing;
    },

    async grantRole(input) {
      const territoryClause = input.territoryId ? eq(userRoleAssignments.territoryId, input.territoryId) : isNull(userRoleAssignments.territoryId);
      const [existing] = await db
        .select({ id: userRoleAssignments.id })
        .from(userRoleAssignments)
        .where(and(eq(userRoleAssignments.userId, input.userId), eq(userRoleAssignments.roleId, input.roleId), eq(userRoleAssignments.organisationId, input.organisationId), territoryClause))
        .limit(1);
      if (existing) return;
      await db.insert(userRoleAssignments).values({ userId: input.userId, roleId: input.roleId, organisationId: input.organisationId, territoryId: input.territoryId ?? null });
    },

    async createSession(input) {
      const [session] = await db.insert(authSessions).values(input).returning();
      if (!session) throw new Error("Session was not created.");
      return toSession(session);
    },

    async findSessionByTokenHash(tokenHash) {
      const [session] = await db.select().from(authSessions).where(eq(authSessions.sessionTokenHash, tokenHash)).limit(1);
      return session ? toSession(session) : null;
    },

    async revokeSession(input) {
      await db.update(authSessions).set({ revokedAt: input.revokedAt, updatedAt: input.revokedAt }).where(eq(authSessions.id, input.sessionId));
    },

    async revokeAllSessionsForUser(input) {
      const ended = await db
        .update(authSessions)
        .set({ revokedAt: input.revokedAt, updatedAt: input.revokedAt })
        .where(and(eq(authSessions.userId, input.userId), isNull(authSessions.revokedAt)))
        .returning({ id: authSessions.id });
      return ended.length;
    },

    async createVerificationToken(input) {
      const [token] = await db.insert(authVerificationTokens).values(input).returning();
      if (!token) throw new Error("Verification token was not created.");
      return token;
    },

    async findVerificationTokenByHash(tokenHash) {
      const [token] = await db.select().from(authVerificationTokens).where(eq(authVerificationTokens.tokenHash, tokenHash)).limit(1);
      return token ?? null;
    },

    async markVerificationTokenUsed(input) {
      const consumed = await db
        .update(authVerificationTokens)
        .set({ usedAt: input.usedAt, updatedAt: input.usedAt })
        .where(and(eq(authVerificationTokens.id, input.tokenId), isNull(authVerificationTokens.usedAt)))
        .returning({ id: authVerificationTokens.id });
      return consumed.length === 1;
    }
  };
}
