import { recordAuditEvent } from "@raring2go/audit";
import { createDb } from "@raring2go/db";
import {
  addRoleGrant,
  assignRole,
  canAdminister,
  createDrizzleAccessStore,
  createRole,
  deleteRole,
  explainAccess,
  inviteUser,
  listAccessOverview,
  readRole,
  removeRoleGrant,
  revokeAssignment,
  revokeInvitationById
} from "@raring2go/access";
import type { AccessActorContext, AccessStore } from "@raring2go/access";
import { createEmailProviderFromEnv, sendInvitationEmail } from "@raring2go/email";
import type { PermissionData } from "@raring2go/permissions";
import { getDirectory } from "./directory";
import { appLogger } from "./logger";
import { getPermissionData, invalidatePermissionData } from "./permission-source";

export type { AccessActorContext };

type Db = ReturnType<typeof createDb>["db"];
type Audit = { record: (input: Parameters<typeof recordAuditEvent>[1]) => Promise<unknown> };

/**
 * One transaction per call, with permissions loaded fresh: the service re-checks the actor's rights
 * against what the database says right now, and a change that breaks an invariant (such as removing
 * the last administrator) is rolled back as a whole.
 */
async function inTransaction<T>(work: (ctx: { permissions: PermissionData; store: AccessStore; audit: Audit }) => Promise<T>): Promise<T> {
  const permissions = await getPermissionData();
  const { db, sql } = createDb();
  try {
    return await db.transaction(async (tx) => {
      const scoped = tx as unknown as Db;
      return work({ permissions, store: createDrizzleAccessStore(scoped), audit: { record: (input) => recordAuditEvent(scoped, input) } });
    });
  } finally {
    await sql.end();
  }
}

/** Changes take effect on this instance immediately; other instances within the permission cache TTL. */
async function changed<T>(work: Promise<T>): Promise<T> {
  const result = await work;
  invalidatePermissionData();
  return result;
}

export async function readAccessOverview(actor: AccessActorContext) {
  const permissions = await getPermissionData();
  const overview = await inTransaction(({ store }) => listAccessOverview(actor, permissions, store));
  return {
    ...overview,
    can: {
      manage: canAdminister(actor, permissions, "manage"),
      assign: canAdminister(actor, permissions, "assign"),
      invite: canAdminister(actor, permissions, "invite")
    },
    checkedAt: new Date()
  };
}

export const readRoleDetail = async (actor: AccessActorContext, roleId: string) => {
  const permissions = await getPermissionData();
  const detail = await inTransaction(({ store }) => readRole(actor, permissions, store, roleId));
  return { ...detail, canManage: canAdminister(actor, permissions, "manage") };
};

export const createRoleAsActor = (actor: AccessActorContext, input: { key: string; name: string; description?: string | null }) =>
  changed(inTransaction(({ permissions, audit, store }) => createRole(actor, permissions, audit, store, input)));

export const addRoleGrantAsActor = (actor: AccessActorContext, input: { roleId: string; permissionId: string; scope: string }) =>
  changed(inTransaction(({ permissions, audit, store }) => addRoleGrant(actor, permissions, audit, store, input)));

export const removeRoleGrantAsActor = (actor: AccessActorContext, input: { roleId: string; permissionId: string; scope: string }) =>
  changed(inTransaction(({ permissions, audit, store }) => removeRoleGrant(actor, permissions, audit, store, input)));

export const deleteRoleAsActor = (actor: AccessActorContext, roleId: string) =>
  changed(inTransaction(({ permissions, audit, store }) => deleteRole(actor, permissions, audit, store, roleId)));

export const assignRoleAsActor = (actor: AccessActorContext, input: { userId: string; roleId: string; organisationId: string; territoryId?: string | null; endsAt?: Date | null }) =>
  changed(inTransaction(({ permissions, audit, store }) => assignRole(actor, permissions, audit, store, input)));

export const revokeAssignmentAsActor = (actor: AccessActorContext, assignmentId: string) =>
  changed(inTransaction(({ permissions, audit, store }) => revokeAssignment(actor, permissions, audit, store, assignmentId)));

export const revokeInvitationAsActor = (actor: AccessActorContext, invitationId: string) =>
  inTransaction(({ permissions, audit, store }) => revokeInvitationById(actor, permissions, audit, store, invitationId));

export async function explainAccessAsActor(actor: AccessActorContext, input: { userId: string; module: string; action: string; organisationId?: string | null; territoryId?: string | null }) {
  return explainAccess(actor, await getPermissionData(), input);
}

export function publicBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000";
}

/**
 * Create the invitation (committed first), then email the link. If sending fails the invitation still
 * exists and the administrator is told, so they can invite again: that replaces the unsent link.
 */
export async function inviteUserAsActor(actor: AccessActorContext, input: { email: string; organisationId: string; territoryId?: string | null; roleId?: string | null }) {
  const { invitation, token } = await inTransaction(({ permissions, audit, store }) => inviteUser(actor, permissions, audit, store, input));

  const directory = getDirectory();
  const url = `${publicBaseUrl()}/invite/accept?token=${encodeURIComponent(token)}&email=${encodeURIComponent(invitation.email)}`;
  let emailSent = false;
  try {
    const result = await sendInvitationEmail(createEmailProviderFromEnv(), {
      to: invitation.email,
      url,
      organisationName: invitation.organisationName ?? (await directory.organisationName(invitation.organisationId)) ?? "Raring2go",
      roleName: invitation.roleName,
      invitedByName: await directory.userName(actor.userId),
      expiresAt: invitation.expiresAt,
      from: process.env.EMAIL_FROM,
      idempotencyKey: `invitation:${invitation.id}`
    });
    emailSent = result.status !== "failed";
  } catch (error) {
    appLogger.error("invitation email failed", { invitationId: invitation.id, error });
  }

  appLogger.info("invitation created", { invitationId: invitation.id, emailSent, actorUserId: actor.userId });
  return { invitation, emailSent };
}
