# Website Publishing Decision

Status: PIL-007 decision recorded.

## Decision

The Next.js public experience is the canonical Raring2go website publishing path for pilot.

WordPress is not part of the canonical pilot architecture and no WordPress bridge is configured in the current codebase.

## Rationale

The platform now has:

- canonical territory routing and public DTOs in `@raring2go/public`;
- approved-content-only public projection rules;
- published publication-output based magazine rendering;
- newsletter/social linkage to canonical platform records;
- privacy-aware public analytics intake and persistence;
- public SEO routes generated from platform territory/content state.

Adding WordPress as an active publishing owner now would create duplicate content ownership, duplicate approval state and a second public rendering path. That would undermine PIL-001's publishability boundary.

## Ownership Boundary

Raring2go platform records are authoritative for:

- territories and area identity;
- articles, events, offers, competitions and public placements;
- digital magazine publication outputs;
- newsletter/social references;
- advertiser public placements;
- public analytics references.

`@raring2go/public` remains the projection boundary. Public routes must render DTOs from that package rather than exposing internal franchise, advertiser, finance, audit or operational records.

## Transitional Bridge Policy

A future bridge may export provider-neutral public projections to another website system only if it:

- reads from approved platform projections;
- does not accept edits back into a parallel CMS without an explicit import/reconciliation workflow;
- preserves publication output/version references;
- does not fork consent, audience, analytics or advertiser records;
- has authenticated, deduplicated webhook/import behaviour;
- can be disabled without losing canonical platform data.

## Pilot Implication

For controlled pilot, the Next.js public site is GREEN as the strategic direction. Any WordPress migration/import/export work should be treated as a later transitional operations task, not a product dependency for the pilot.
