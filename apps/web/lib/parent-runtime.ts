import { randomUUID } from "node:crypto";
import { audienceContacts, audienceSavedContent, createDb } from "@raring2go/db";
import { recordServerPublicEvent } from "./public-events";
import { and, eq, isNull } from "drizzle-orm";
import { hashToken, normalizeEmail } from "@raring2go/auth";
import { withIdentity } from "./auth-runtime";
import {
  loadParentAccount,
  setEmailOptOut,
  setEmailSubscription,
  updateParentPreferences,
  type ParentPreferenceInput
} from "@raring2go/marketing";
import {
  getPublicDiscovery,
  getPublicHomepage,
  getPublicParentHub,
  getPublicRecommendations,
  resolvePublicTerritory
} from "@raring2go/public";

export type ParentSessionResolution =
  | {
      authenticated: true;
      userId: string;
      email: string;
      contactId: string;
    }
  | {
      authenticated: false;
      reason: "missing_session" | "invalid_session" | "no_parent_contact";
    };

export async function resolveParentSession(sessionToken?: string | null): Promise<ParentSessionResolution> {
  if (!sessionToken) {
    return { authenticated: false, reason: "missing_session" };
  }

  const identity = await withIdentity(async ({ repository }) => {
    const session = await repository.findSessionByTokenHash(hashToken(sessionToken));
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return undefined;
    const found = await repository.findUserById(session.userId);
    return found && found.status === "active" ? found : undefined;
  });
  if (!identity) {
    return { authenticated: false, reason: "invalid_session" };
  }
  const user = identity;

  const contact = await ensureAudienceContactForUser(user.email);
  return {
    authenticated: true,
    userId: user.id,
    email: user.email,
    contactId: contact.id
  };
}

export class ParentSignInRequiredError extends Error {
  constructor() {
    super("Parent sign-in is required.");
  }
}

/**
 * Runs a self-service change as the signed-in parent. The contact comes from the
 * session, never from the request, so a parent can only ever touch their own record;
 * the change and its consent/audit rows commit or fail together.
 */
async function asParent<T>(
  sessionToken: string | null | undefined,
  work: (db: Parameters<typeof loadParentAccount>[0], parent: { userId: string; contactId: string }) => Promise<T>
): Promise<T> {
  const resolved = await resolveParentSession(sessionToken);
  if (!resolved.authenticated) throw new ParentSignInRequiredError();

  const { db, sql } = createDb();
  try {
    return await db.transaction((tx) => work(tx, { userId: resolved.userId, contactId: resolved.contactId }));
  } finally {
    await sql.end();
  }
}

export async function readParentAccount(sessionToken?: string | null) {
  const resolved = await resolveParentSession(sessionToken);
  if (!resolved.authenticated) return undefined;

  const { db, sql } = createDb();
  try {
    return await loadParentAccount(db, { userId: resolved.userId, contactId: resolved.contactId });
  } finally {
    await sql.end();
  }
}

export const saveParentPreferences = (sessionToken: string | null | undefined, input: ParentPreferenceInput) =>
  asParent(sessionToken, (db, parent) => updateParentPreferences(db, parent, input));

export const changeParentEmailSubscription = async (sessionToken: string | null | undefined, input: { territoryId: string; subscribed: boolean }) => {
  const result = await asParent(sessionToken, (db, parent) => setEmailSubscription(db, parent, input));
  // The parent pressed "email me" and the subscription really changed: that is the completed signup. No contact is recorded with it.
  if (input.subscribed && (result as { changed?: boolean } | undefined)?.changed !== false) {
    const { db, sql } = createDb();
    try {
      await recordServerPublicEvent(db, sql, input.territoryId, { eventType: "newsletter_signup_completed", path: "/areas/{slug}/preferences", entityType: "newsletter" });
    } finally {
      await sql.end();
    }
  }
  return result;
};

export const changeParentEmailOptOut = (sessionToken: string | null | undefined, optOut: boolean) =>
  asParent(sessionToken, (db, parent) => setEmailOptOut(db, parent, optOut));

export async function parentHasInternalAccess(sessionToken?: string | null) {
  if (!sessionToken) return false;
  return withIdentity(async ({ repository }) => {
    const session = await repository.findSessionByTokenHash(hashToken(sessionToken));
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return false;
    const user = await repository.findUserById(session.userId);
    if (!user || user.status !== "active") return false;
    const memberships = await repository.findMembershipsForUser(session.userId);
    return memberships.some((membership) => membership.status === "active");
  });
}

export async function readSessionBackedParentHub(slug: string, sessionToken?: string | null) {
  const parent = await resolveParentSession(sessionToken);
  const { db, sql } = createDb();

  try {
    return getPublicParentHub(db, slug, parent.authenticated ? parent.contactId : null);
  } finally {
    await sql.end();
  }
}

export async function readSessionBackedRecommendations(slug: string, sessionToken?: string | null) {
  const parent = await resolveParentSession(sessionToken);
  const { db, sql } = createDb();

  try {
    return getPublicRecommendations(db, slug, parent.authenticated ? parent.contactId : null);
  } finally {
    await sql.end();
  }
}

export async function savePublicContentForParent(input: {
  sessionToken?: string | null;
  territorySlug: string;
  contentId: string;
}) {
  const parent = await resolveParentSession(input.sessionToken);
  if (!parent.authenticated) {
    throw new ParentSignInRequiredError();
  }

  const { db, sql } = createDb();
  try {
    const territory = await resolvePublicTerritory(db, input.territorySlug);
    if (!territory) {
      throw new Error("Unknown public territory.");
    }
    const homepage = await getPublicHomepage(db, input.territorySlug);
    const [whatsOn, activities] = await Promise.all([
      getPublicDiscovery(db, input.territorySlug, "whats_on"),
      getPublicDiscovery(db, input.territorySlug, "activities")
    ]);
    const visibleContent = [
      ...(homepage?.stories ?? []),
      ...(homepage?.whatsOn ?? []),
      ...(homepage?.thingsToDo ?? []),
      ...(whatsOn?.items ?? []),
      ...(activities?.items ?? [])
    ].find((item) => item.id === input.contentId);
    if (!visibleContent) {
      throw new Error("Only public content can be saved.");
    }

    const [existing] = await db
      .select({ id: audienceSavedContent.id })
      .from(audienceSavedContent)
      .where(and(eq(audienceSavedContent.contactId, parent.contactId), eq(audienceSavedContent.contentReferenceId, input.contentId), isNull(audienceSavedContent.deletedAt)))
      .limit(1);
    if (existing) return { saved: true, id: existing.id };

    const id = randomUUID();
    await db.insert(audienceSavedContent).values({
      id,
      contactId: parent.contactId,
      territoryId: territory.id,
      contentType: visibleContent.type,
      contentReferenceId: visibleContent.id,
      title: visibleContent.title,
      savedAt: new Date(),
      metadata: { source: "public_parent_account" }
    });
    await recordServerPublicEvent(db, sql, territory.id, { eventType: "content_saved", path: `/areas/${territory.slug}/saved`, entityType: "content", entityId: visibleContent.id, metadata: { contentType: visibleContent.type } });
    return { saved: true, id };
  } finally {
    await sql.end();
  }
}

export async function unsavePublicContentForParent(input: {
  sessionToken?: string | null;
  contentId: string;
}) {
  const parent = await resolveParentSession(input.sessionToken);
  if (!parent.authenticated) {
    throw new ParentSignInRequiredError();
  }

  const { db, sql } = createDb();
  try {
    await db
      .update(audienceSavedContent)
      .set({ deletedAt: new Date() })
      .where(and(eq(audienceSavedContent.contactId, parent.contactId), eq(audienceSavedContent.contentReferenceId, input.contentId), isNull(audienceSavedContent.deletedAt)));
    return { saved: false };
  } finally {
    await sql.end();
  }
}

/**
 * Finds or creates the parent's audience contact. Creating one grants no consent: the
 * contact has no subscriptions until the parent chooses some. One statement, so two
 * simultaneous first visits cannot create two contacts (the email index is unique).
 */
async function ensureAudienceContactForUser(email: string) {
  const emailNormalised = normalizeEmail(email);
  const { db, sql } = createDb();

  try {
    await db
      .insert(audienceContacts)
      .values({ id: randomUUID(), email, emailNormalised, tags: [], metadata: { source: "parent_account", consentCreated: false } })
      .onConflictDoNothing({ target: audienceContacts.emailNormalised });
    const [contact] = await db
      .select({ id: audienceContacts.id, email: audienceContacts.email, emailNormalised: audienceContacts.emailNormalised })
      .from(audienceContacts)
      .where(and(eq(audienceContacts.emailNormalised, emailNormalised), isNull(audienceContacts.deletedAt)))
      .limit(1);
    if (!contact) throw new Error("Unable to create parent audience contact.");
    return contact;
  } finally {
    await sql.end();
  }
}
