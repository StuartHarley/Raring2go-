import { authInvitations, competitionEntries, authSessions, authVerificationTokens, publicAnalyticsEvents, rateLimitBuckets, webhookEventClaims } from "@raring2go/db";
import type { createDb } from "@raring2go/db";
import { and, eq, isNotNull, lt, or } from "drizzle-orm";

type Db = ReturnType<typeof createDb>["db"];

const DAY = 86_400_000;

/**
 * What the platform keeps and for how long. This is the single, reviewable statement of
 * retention; `enforceRetention` implements exactly the rows marked `enforced`, and the
 * security checklist lists the rest as decisions still owed by the data controller.
 */
export type RetentionPolicy = {
  key: string;
  data: string;
  keep: string;
  basis: string;
  enforced: boolean;
};

export const retentionPolicies: RetentionPolicy[] = [
  { key: "auth_sessions", data: "Expired or revoked sign-in sessions", keep: "30 days after expiry or revocation", basis: "Security investigation window", enforced: true },
  { key: "auth_verification_tokens", data: "One-time sign-in links", keep: "7 days after expiry or use", basis: "Replay investigation; the token itself is stored hashed", enforced: true },
  { key: "auth_invitations", data: "Staff and franchisee invitations", keep: "90 days after expiry, acceptance or revocation", basis: "Onboarding audit trail", enforced: true },
  { key: "public_analytics_events", data: "Pseudonymous public website analytics events", keep: "Until each row's own retain_until (18 months from the event)", basis: "Aggregate reporting only; recorded per row at collection", enforced: true },
  { key: "rate_limit_buckets", data: "Rate limit counters (hashed keys)", keep: "2 days", basis: "Operational only", enforced: true },
  { key: "webhook_event_claims", data: "Provider webhook idempotency claims", keep: "90 days", basis: "Longer than any provider's retry window; only the provider event id is held", enforced: true },
  { key: "jobs", data: "Completed background job history", keep: "30 days", basis: "Operations; enforced by the job-history prune job (OPS-001)", enforced: true },
  { key: "competition_entries", data: "Entries to public competitions", keep: "Entries that did not win: 90 days after entry. Winning entries: 12 months after the draw", basis: "Running the draw and resolving disputes; the entry holds only who entered, when, and whether they won", enforced: true },
  { key: "audit_events", data: "Audit trail", keep: "Indefinitely (append-only)", basis: "Accountability; personal data inside events is redacted at write time", enforced: false },
  { key: "privacy_requests", data: "Data-subject request records", keep: "6 years", basis: "Evidence of compliance; holds only a hash of the subject's email", enforced: false },
  { key: "email_delivery_records", data: "Per-recipient email delivery outcomes", keep: "Decision owed by the data controller", basis: "Needed for suppression and complaint handling; anonymised on erasure", enforced: false },
  { key: "audience_contacts", data: "Subscriber records", keep: "While subscribed; erased on request", basis: "Consent; see the data-subject request workflow", enforced: false }
];

export type RetentionResult = Record<string, number>;

/**
 * Delete what the retention policy says is past its time. Every rule is a bounded
 * DELETE ... RETURNING on an indexed column, so it is safe to re-run and reports counts.
 * Nothing here touches audit events or any data the controller still owes a decision on.
 */
export async function enforceRetention(db: Db, now: Date = new Date()): Promise<RetentionResult> {
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const result: RetentionResult = {};

  result.auth_sessions = (
    await db
      .delete(authSessions)
      .where(or(lt(authSessions.expiresAt, ago(30)), and(isNotNull(authSessions.revokedAt), lt(authSessions.revokedAt, ago(30)))))
      .returning({ id: authSessions.id })
  ).length;

  result.auth_verification_tokens = (
    await db
      .delete(authVerificationTokens)
      .where(or(lt(authVerificationTokens.expiresAt, ago(7)), and(isNotNull(authVerificationTokens.usedAt), lt(authVerificationTokens.usedAt, ago(7)))))
      .returning({ id: authVerificationTokens.id })
  ).length;

  result.auth_invitations = (
    await db
      .delete(authInvitations)
      .where(
        or(
          lt(authInvitations.expiresAt, ago(90)),
          and(isNotNull(authInvitations.acceptedAt), lt(authInvitations.acceptedAt, ago(90))),
          and(isNotNull(authInvitations.revokedAt), lt(authInvitations.revokedAt, ago(90)))
        )
      )
      .returning({ id: authInvitations.id })
  ).length;

  result.public_analytics_events = (await db.delete(publicAnalyticsEvents).where(lt(publicAnalyticsEvents.retainUntil, now)).returning({ id: publicAnalyticsEvents.id })).length;

  result.rate_limit_buckets = (await db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.windowStart, ago(2))).returning({ key: rateLimitBuckets.key })).length;

  result.webhook_event_claims = (await db.delete(webhookEventClaims).where(lt(webhookEventClaims.claimedAt, ago(90))).returning({ id: webhookEventClaims.id })).length;

  // Entries that did not win go after 90 days; winners are kept 12 months from the draw in case a prize is disputed.
  result.competition_entries = (
    await db
      .delete(competitionEntries)
      .where(or(and(eq(competitionEntries.outcome, "entered"), lt(competitionEntries.enteredAt, ago(90))), and(eq(competitionEntries.outcome, "winner"), lt(competitionEntries.drawnAt, ago(365)))))
      .returning({ id: competitionEntries.id })
  ).length;

  return result;
}
