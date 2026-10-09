import { randomUUID } from "node:crypto";
import { auditActions, recordAuditEvent } from "@raring2go/audit";
import {
  audienceConsentEvents,
  audienceContacts,
  audiencePreferenceProfiles,
  audienceSavedContent,
  audienceSuppressions,
  audienceTerritorySubscriptions,
  territories
} from "@raring2go/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

/**
 * Parent self-service (EXT-002 / MKT-007 / PUB-005).
 *
 * A parent acts only on their own audience contact. The contact is derived from the
 * signed-in session by the caller, never from client input, so every function here
 * takes the parent's own `contactId` and cannot reach anyone else's record.
 *
 * Consent semantics:
 *  - *Following* an area is a personalisation choice (profile) and sends nothing.
 *  - *Email subscription* to an area is explicit consent; each change writes a consent
 *    event and flips the territory subscription that audience eligibility reads.
 *  - *Opting out of all email* is an active suppression owned by the parent. Only
 *    suppressions the parent created themselves can be lifted by the parent; bounces,
 *    complaints and staff suppressions can never be undone from here.
 */

export const parentAgeBands = ["pregnancy", "baby-toddler", "preschool", "primary", "secondary", "teen"] as const;
export const newsletterFrequencies = ["weekly", "fortnightly", "monthly", "school_holidays_only"] as const;

/** Reasons a parent may lift themselves. Everything else needs staff or a provider. */
export const parentLiftableSuppressionReasons = ["parent_opt_out", "recipient_unsubscribe"] as const;

const maxFreeTextItems = 20;
const maxFreeTextLength = 40;

// Structural type, so a transaction handle works as well as the pool.
type ParentDb = Pick<ReturnType<typeof import("@raring2go/db").createDb>["db"], "select" | "insert" | "update" | "delete">;

export type ParentActor = { userId: string; contactId: string };

export class ParentSelfServiceError extends Error {
  constructor(
    readonly code: "unknown_territory" | "invalid_preferences" | "not_public_content" | "contact_missing",
    message: string
  ) {
    super(message);
  }
}

export type ParentPreferenceInput = {
  homeTerritoryId?: string | null;
  followedTerritoryIds: string[];
  childAgeBands: string[];
  interests: string[];
  eventCategories: string[];
  offerPreferences: string[];
  competitionPreferences: string[];
  newsletterFrequency: string;
  personalisationEnabled: boolean;
};

export type ParentAccountView = {
  contact: { id: string; email: string; emailStatus: string };
  emailOptedOut: boolean;
  /** Suppressions the parent cannot lift (bounce, complaint, staff). */
  lockedSuppressions: string[];
  territories: Array<{ id: string; name: string; following: boolean; emailSubscribed: boolean }>;
  preferences: ParentPreferenceInput;
  saved: Array<{ id: string; title: string; contentType: string; savedAt: Date }>;
};

const defaultPreferences: ParentPreferenceInput = {
  homeTerritoryId: null,
  followedTerritoryIds: [],
  childAgeBands: [],
  interests: [],
  eventCategories: [],
  offerPreferences: [],
  competitionPreferences: [],
  newsletterFrequency: "weekly",
  personalisationEnabled: true
};

export async function loadParentAccount(db: ParentDb, parent: ParentActor): Promise<ParentAccountView> {
  const [contact] = await db.select().from(audienceContacts).where(and(eq(audienceContacts.id, parent.contactId), isNull(audienceContacts.deletedAt)));
  if (!contact) throw new ParentSelfServiceError("contact_missing", "Your account has no audience record.");

  const [areas, subscriptions, [profile], suppressions, saved] = await Promise.all([
    db.select().from(territories).where(and(eq(territories.status, "active"), isNull(territories.deletedAt))),
    db.select().from(audienceTerritorySubscriptions).where(and(eq(audienceTerritorySubscriptions.contactId, contact.id), isNull(audienceTerritorySubscriptions.deletedAt))),
    db.select().from(audiencePreferenceProfiles).where(and(eq(audiencePreferenceProfiles.contactId, contact.id), isNull(audiencePreferenceProfiles.deletedAt))),
    db.select().from(audienceSuppressions).where(and(eq(audienceSuppressions.contactId, contact.id), eq(audienceSuppressions.active, true))),
    db.select().from(audienceSavedContent).where(and(eq(audienceSavedContent.contactId, contact.id), isNull(audienceSavedContent.deletedAt)))
  ]);

  const followed = new Set(profile?.followedTerritoryIds ?? []);
  const subscribed = new Set(subscriptions.filter((subscription) => subscription.status === "subscribed").map((subscription) => subscription.territoryId));
  const liftable = new Set<string>(parentLiftableSuppressionReasons);

  return {
    contact: { id: contact.id, email: contact.email, emailStatus: contact.emailStatus },
    emailOptedOut: suppressions.some((suppression) => liftable.has(suppression.reason)),
    lockedSuppressions: suppressions.filter((suppression) => !liftable.has(suppression.reason)).map((suppression) => suppression.reason),
    territories: areas
      .map((area) => ({ id: area.id, name: area.name, following: followed.has(area.id), emailSubscribed: subscribed.has(area.id) }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    preferences: profile
      ? {
          homeTerritoryId: profile.homeTerritoryId,
          followedTerritoryIds: profile.followedTerritoryIds,
          childAgeBands: profile.childAgeBands,
          interests: profile.interests,
          eventCategories: profile.eventCategories,
          offerPreferences: profile.offerPreferences,
          competitionPreferences: profile.competitionPreferences,
          newsletterFrequency: profile.newsletterFrequency,
          personalisationEnabled: profile.personalisationEnabled
        }
      : { ...defaultPreferences },
    saved: saved
      .map((item) => ({ id: item.id, title: item.title, contentType: item.contentType, savedAt: item.savedAt }))
      .sort((left, right) => right.savedAt.getTime() - left.savedAt.getTime())
  };
}

/** Validates and normalises parent-supplied preferences. Pure, so it is unit tested. */
export function normaliseParentPreferences(input: ParentPreferenceInput): ParentPreferenceInput {
  const ageBands = new Set<string>(parentAgeBands);
  if (!input.childAgeBands.every((band) => ageBands.has(band))) {
    throw new ParentSelfServiceError("invalid_preferences", "Only broad age ranges can be chosen.");
  }
  if (!(newsletterFrequencies as readonly string[]).includes(input.newsletterFrequency)) {
    throw new ParentSelfServiceError("invalid_preferences", "Choose a supported email frequency.");
  }

  const words = (values: string[]) => {
    const cleaned = [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
    if (cleaned.length > maxFreeTextItems || cleaned.some((value) => value.length > maxFreeTextLength)) {
      throw new ParentSelfServiceError("invalid_preferences", "Interests must be short, and there is a limit on how many you can add.");
    }
    return cleaned;
  };

  return {
    homeTerritoryId: input.homeTerritoryId || null,
    followedTerritoryIds: [...new Set(input.followedTerritoryIds)],
    childAgeBands: [...new Set(input.childAgeBands)],
    interests: words(input.interests),
    eventCategories: words(input.eventCategories),
    offerPreferences: words(input.offerPreferences),
    competitionPreferences: words(input.competitionPreferences),
    newsletterFrequency: input.newsletterFrequency,
    personalisationEnabled: input.personalisationEnabled
  };
}

export async function updateParentPreferences(db: ParentDb, parent: ParentActor, raw: ParentPreferenceInput) {
  const input = normaliseParentPreferences(raw);
  const wanted = [...input.followedTerritoryIds, ...(input.homeTerritoryId ? [input.homeTerritoryId] : [])];
  await requirePublicTerritories(db, wanted);

  const [existing] = await db.select().from(audiencePreferenceProfiles).where(eq(audiencePreferenceProfiles.contactId, parent.contactId));
  const values = {
    homeTerritoryId: input.homeTerritoryId ?? null,
    followedTerritoryIds: input.followedTerritoryIds,
    childAgeBands: input.childAgeBands,
    interests: input.interests,
    eventCategories: input.eventCategories,
    offerPreferences: input.offerPreferences,
    competitionPreferences: input.competitionPreferences,
    newsletterFrequency: input.newsletterFrequency,
    personalisationEnabled: input.personalisationEnabled,
    deletedAt: null
  };

  if (existing) {
    await db.update(audiencePreferenceProfiles).set(values).where(eq(audiencePreferenceProfiles.id, existing.id));
  } else {
    await db.insert(audiencePreferenceProfiles).values({
      id: randomUUID(),
      contactId: parent.contactId,
      communicationPreferences: {},
      privacyMetadata: { source: "parent_account", minimised: true },
      ...values
    });
  }

  await recordAuditEvent(db, {
    action: auditActions.audiencePreferenceUpdate,
    actor: { type: "human", userId: parent.userId },
    entity: { type: "audience_contact", id: parent.contactId },
    metadata: { source: "parent_account" },
    after: {
      followedTerritories: input.followedTerritoryIds.length,
      childAgeBands: input.childAgeBands,
      newsletterFrequency: input.newsletterFrequency,
      personalisationEnabled: input.personalisationEnabled
    }
  });
}

/**
 * Explicit email consent for one area. Idempotent: repeating the same choice changes
 * nothing and records no extra consent event.
 */
export async function setEmailSubscription(db: ParentDb, parent: ParentActor, input: { territoryId: string; subscribed: boolean }) {
  await requirePublicTerritories(db, [input.territoryId]);
  const now = new Date();
  const status = input.subscribed ? "subscribed" : "unsubscribed";

  const [existing] = await db
    .select()
    .from(audienceTerritorySubscriptions)
    .where(and(eq(audienceTerritorySubscriptions.contactId, parent.contactId), eq(audienceTerritorySubscriptions.territoryId, input.territoryId)));
  if (existing && existing.status === status && !existing.deletedAt) return { changed: false };

  await db
    .insert(audienceTerritorySubscriptions)
    .values({
      id: randomUUID(),
      contactId: parent.contactId,
      territoryId: input.territoryId,
      status,
      source: "parent_account",
      preferences: {},
      subscribedAt: input.subscribed ? now : null,
      unsubscribedAt: input.subscribed ? null : now
    })
    .onConflictDoUpdate({
      target: [audienceTerritorySubscriptions.contactId, audienceTerritorySubscriptions.territoryId],
      set: { status, source: "parent_account", deletedAt: null, subscribedAt: input.subscribed ? now : existing?.subscribedAt ?? null, unsubscribedAt: input.subscribed ? null : now }
    });

  await recordConsent(db, parent, input.territoryId, input.subscribed ? "granted" : "withdrawn", now);
  await recordAuditEvent(db, {
    action: auditActions.marketingAudienceSubscribe,
    actor: { type: "human", userId: parent.userId },
    entity: { type: "audience_contact", id: parent.contactId },
    scope: { territoryId: input.territoryId },
    after: { status, source: "parent_account" }
  });
  return { changed: true };
}

/**
 * Opt out of (or back in to) all Raring2go email. Opting out creates an active
 * suppression, which removes the contact from every audience. Opting back in lifts
 * only suppressions the parent could have created themselves.
 */
export async function setEmailOptOut(db: ParentDb, parent: ParentActor, optOut: boolean) {
  const now = new Date();
  const [contact] = await db.select().from(audienceContacts).where(eq(audienceContacts.id, parent.contactId));
  if (!contact) throw new ParentSelfServiceError("contact_missing", "Your account has no audience record.");

  const active = await db
    .select()
    .from(audienceSuppressions)
    .where(and(eq(audienceSuppressions.contactId, parent.contactId), eq(audienceSuppressions.active, true)));
  const liftable = active.filter((suppression) => (parentLiftableSuppressionReasons as readonly string[]).includes(suppression.reason));

  if (optOut) {
    if (liftable.length > 0) return { changed: false };
    // A previously lifted opt-out is reactivated rather than duplicated.
    const [previous] = await db
      .select()
      .from(audienceSuppressions)
      .where(and(eq(audienceSuppressions.contactId, parent.contactId), eq(audienceSuppressions.reason, "parent_opt_out"), isNull(audienceSuppressions.territoryId)));
    if (previous) {
      await db.update(audienceSuppressions).set({ active: true, suppressedAt: now }).where(eq(audienceSuppressions.id, previous.id));
    } else {
      await db.insert(audienceSuppressions).values({
        id: randomUUID(),
        contactId: parent.contactId,
        emailNormalised: contact.emailNormalised,
        territoryId: null,
        reason: "parent_opt_out",
        source: "parent_account",
        active: true,
        suppressedAt: now,
        metadata: {}
      });
    }
    await db.update(audienceContacts).set({ emailStatus: "suppressed" }).where(eq(audienceContacts.id, parent.contactId));
  } else {
    if (liftable.length === 0) return { changed: false };
    await db.update(audienceSuppressions).set({ active: false }).where(inArray(audienceSuppressions.id, liftable.map((suppression) => suppression.id)));
    // Contact stays suppressed if something the parent cannot lift is still active.
    if (active.length === liftable.length) {
      await db.update(audienceContacts).set({ emailStatus: "subscribed" }).where(eq(audienceContacts.id, parent.contactId));
    }
  }

  await recordConsent(db, parent, null, optOut ? "withdrawn" : "granted", now);
  await recordAuditEvent(db, {
    action: auditActions.marketingAudienceSuppress,
    actor: { type: "human", userId: parent.userId },
    entity: { type: "audience_contact", id: parent.contactId },
    after: { optOut, source: "parent_account" }
  });
  return { changed: true };
}

async function recordConsent(db: ParentDb, parent: ParentActor, territoryId: string | null, action: "granted" | "withdrawn", occurredAt: Date) {
  await db.insert(audienceConsentEvents).values({
    id: randomUUID(),
    contactId: parent.contactId,
    territoryId,
    consentType: "email_marketing",
    action,
    source: "parent_account",
    occurredAt,
    actorUserId: parent.userId,
    evidence: { channel: "parent_preference_centre" }
  });
}

async function requirePublicTerritories(db: ParentDb, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const found = await db
    .select({ id: territories.id })
    .from(territories)
    .where(and(inArray(territories.id, unique), eq(territories.status, "active"), isNull(territories.deletedAt)));
  if (found.length !== unique.length) {
    throw new ParentSelfServiceError("unknown_territory", "That area is not available.");
  }
}
