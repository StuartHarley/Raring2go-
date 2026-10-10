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

## Territory homepage layout (HQ-controlled)

HQ chooses what every territory homepage shows at **Content Studio, Website homepage layout** (`/app/content/homepage`, permission `public.homepage manage`, HQ only). The page is drawn from the live layout, section by section, in the order HQ sets.

HQ controls, per section: whether it shows, its position, its heading (up to 80 characters), how many items (within a per-section limit) and where items come from (local then network, local only, network only). The sections are the top banner, latest stories, what's on, things to do, the digital magazine, offers, competitions, recommended local businesses and the newsletter sign-up.

Rules that cannot be changed from the editor (they live in `packages/public/src/homepage-template.ts`, so every path obeys them):
- the **top banner and the newsletter sign-up always stay**, and are always visible;
- each section appears **at most once**;
- **offers, competitions and local businesses always carry the "Sponsored" label**, whatever is submitted;
- ids, seasonal treatment and the sponsored flag are set by the code, never taken from the form;
- a section the site cannot yet draw (the old "community" slot) cannot be chosen.

Versions: saving makes or updates one **draft**; publishing makes it live for every territory and retires the previous live version, which is kept as history. A published or retired version can never be edited, deleted or revived (a database trigger enforces it, migration 0057): bringing an old look back means starting a new draft from it. Every save, publish and discard is audited. If the live layout were ever unusable, the site falls back to the built-in default, so the homepage cannot go blank.

Not built: a different layout per territory (one layout applies to all), scheduled publishing, and a preview of the draft on a real territory page before it goes live.
