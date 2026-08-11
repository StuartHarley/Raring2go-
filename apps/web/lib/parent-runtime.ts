import { randomUUID } from "node:crypto";
import { createDb } from "@raring2go/db";
import { hashToken, normalizeEmail } from "@raring2go/auth";
import { appAuthRepository } from "./auth-runtime";
import {
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

  const session = await appAuthRepository.findSessionByTokenHash(hashToken(sessionToken));
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return { authenticated: false, reason: "invalid_session" };
  }

  const user = appAuthRepository.users.find((candidate) => candidate.id === session.userId && candidate.status === "active");
  if (!user) {
    return { authenticated: false, reason: "invalid_session" };
  }

  const contact = await ensureAudienceContactForUser(user.email);
  return {
    authenticated: true,
    userId: user.id,
    email: user.email,
    contactId: contact.id
  };
}

export async function parentHasInternalAccess(sessionToken?: string | null) {
  if (!sessionToken) return false;
  const session = await appAuthRepository.findSessionByTokenHash(hashToken(sessionToken));
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return false;
  const memberships = await appAuthRepository.findMembershipsForUser(session.userId);
  return memberships.some((membership) => membership.status === "active");
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
    throw new Error("Parent sign-in is required to save content.");
  }

  const { db, sql } = createDb();
  try {
    const territory = await resolvePublicTerritory(db, input.territorySlug);
    if (!territory) {
      throw new Error("Unknown public territory.");
    }
    const homepage = await getPublicHomepage(db, input.territorySlug);
    const visibleContent = [
      ...(homepage?.stories ?? []),
      ...(homepage?.whatsOn ?? []),
      ...(homepage?.thingsToDo ?? [])
    ].find((item) => item.id === input.contentId);
    if (!visibleContent) {
      throw new Error("Only public content can be saved.");
    }

    const existing = await sql`
      select id
      from audience_saved_content
      where contact_id = ${parent.contactId}
        and content_reference_id = ${input.contentId}
        and deleted_at is null
      limit 1
    `;
    if (existing.length > 0) {
      return { saved: true, id: existing[0]?.id };
    }

    const id = randomUUID();
    await sql`
      insert into audience_saved_content (
        id,
        contact_id,
        territory_id,
        content_type,
        content_reference_id,
        title,
        saved_at,
        metadata
      )
      values (
        ${id},
        ${parent.contactId},
        ${territory.id},
        ${visibleContent.type},
        ${visibleContent.id},
        ${visibleContent.title},
        ${new Date()},
        ${sql.json({ source: "public_parent_account" })}
      )
    `;
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
    throw new Error("Parent sign-in is required to unsave content.");
  }

  const { sql } = createDb();
  try {
    await sql`
      update audience_saved_content
      set deleted_at = ${new Date()}
      where contact_id = ${parent.contactId}
        and content_reference_id = ${input.contentId}
        and deleted_at is null
    `;
    return { saved: false };
  } finally {
    await sql.end();
  }
}

async function ensureAudienceContactForUser(email: string) {
  const emailNormalised = normalizeEmail(email);
  const { sql } = createDb();

  try {
    const existing = await sql`
      select id, email, email_normalised
      from audience_contacts
      where email_normalised = ${emailNormalised}
        and deleted_at is null
      limit 1
    `;
    if (existing[0]) {
      return existing[0];
    }

    const id = randomUUID();
    const [contact] = await sql`
      insert into audience_contacts (
        id,
        email,
        email_normalised,
        email_status,
        tags,
        metadata
      )
      values (
        ${id},
        ${email},
        ${emailNormalised},
        'active',
        ${sql.json([])},
        ${sql.json({ source: "parent_account", consentCreated: false })}
      )
      returning id, email, email_normalised
    `;
    if (!contact) {
      throw new Error("Unable to create parent audience contact.");
    }
    return contact;
  } finally {
    await sql.end();
  }
}
