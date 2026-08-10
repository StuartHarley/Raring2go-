import {
  authInvitations,
  authSessions,
  memberships,
  territories,
  users
} from "@raring2go/db";
import { and, eq } from "drizzle-orm";
import type { AuthRepository } from "./types";

type DrizzleAuthDatabase = {
  select: Function;
  insert: Function;
  update: Function;
};

export function createDrizzleAuthRepository(db: DrizzleAuthDatabase): AuthRepository {
  return {
    async findUserByEmail(email) {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return user ?? null;
    },
    async createUser(input) {
      const [user] = await db
        .insert(users)
        .values({
          email: input.email,
          displayName: input.displayName
        })
        .returning();

      if (!user) {
        throw new Error("User was not created.");
      }

      return user;
    },
    async findMembershipsForUser(userId) {
      return db.select().from(memberships).where(eq(memberships.userId, userId));
    },
    async findTerritoryById(territoryId) {
      const [territory] = await db
        .select()
        .from(territories)
        .where(eq(territories.id, territoryId))
        .limit(1);
      return territory ?? null;
    },
    async findInvitationByTokenHash(tokenHash) {
      const [invitation] = await db
        .select()
        .from(authInvitations)
        .where(eq(authInvitations.tokenHash, tokenHash))
        .limit(1);
      return invitation ?? null;
    },
    async markInvitationAccepted(input) {
      await db
        .update(authInvitations)
        .set({
          status: "accepted",
          acceptedByUserId: input.userId,
          acceptedAt: input.acceptedAt,
          updatedAt: input.acceptedAt
        })
        .where(eq(authInvitations.id, input.invitationId));
    },
    async ensureMembership(input) {
      const [existing] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, input.userId),
            eq(memberships.organisationId, input.organisationId)
          )
        )
        .limit(1);

      if (existing) {
        return existing;
      }

      const [membership] = await db
        .insert(memberships)
        .values({
          userId: input.userId,
          organisationId: input.organisationId,
          status: input.status
        })
        .returning();

      if (!membership) {
        throw new Error("Membership was not created.");
      }

      return membership;
    },
    async createSession(input) {
      const [session] = await db
        .insert(authSessions)
        .values(input)
        .returning();

      if (!session) {
        throw new Error("Session was not created.");
      }

      return session;
    },
    async findSessionByTokenHash(tokenHash) {
      const [session] = await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.sessionTokenHash, tokenHash))
        .limit(1);
      return session ?? null;
    },
    async revokeSession(input) {
      await db
        .update(authSessions)
        .set({
          revokedAt: input.revokedAt,
          updatedAt: input.revokedAt
        })
        .where(eq(authSessions.id, input.sessionId));
    }
  };
}
