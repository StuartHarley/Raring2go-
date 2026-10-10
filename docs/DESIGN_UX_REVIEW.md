# Design & UX Review — Raring2go! Business-in-a-Box

Reviewed 2026-10-09 against `feature/edition-factory` (base commit 7c77871) on the local dev server.

## Scope and method

- Surfaces: the operator app (`/app/*`) as Super Admin and as a Franchisee, the parent-facing area site (`/areas/sutton-coldfield/*`), sign-in/sign-out, and the `/design-system` showcase.
- Viewports: 1440×900 desktop and 375×812 mobile.
- Evidence: screenshots of every main nav destination, page text and computed styles via the browser, and a read of `packages/ui`, `apps/web/app/globals.css`, `apps/web/lib/app-shell.ts`, `apps/web/app/(app)/layout.tsx` and `docs/brand/R2GO_Brand_Guidelines.pdf`.

## Verdict

| Question | Score | One-line answer |
| --- | --- | --- |
| On brand? | 6 / 10 | Colours and type are faithful to the 2018 guidelines; there is no logo, no favicon, and the product voice reads like an architecture document. |
| Easy to navigate? | 5 / 10 | Grouped, permission-aware sidebar is a good skeleton, but it is a flat wall of up to 31 text links, there is no sign-out or account control, every page shares one browser title, and dead ends are unbranded. |
| Looks amazing? | 4 / 10 | Clean, calm and consistent, but not yet premium: every page is a vertical stack of identical white cards, with no icons, no imagery, little hierarchy, raw UUIDs and enum strings on screen. The public site hero is the one surface that feels designed. |
| Delivers? | 6 / 10 | The vertical workflows are real and well explained, but the design-system package is not used by the product, two nav destinations are placeholders, and the franchisee is shown HQ-voiced screens. |

Overall: a solid, honest operations UI with the right bones. It is not yet the "premium 2026 operating system" that `docs/DESIGN_SYSTEM.md` promises, and the gap is mostly in the shell, the presentation layer and copy rather than in the domain work.

## What is working

- **Brand tokens are correct.** `packages/ui/src/tokens.ts` matches the guideline values exactly (purple `#852890`, plum `#400044`, the four seasonal accents, the identity gradient). The gradient is reserved for primary actions, which is the right restraint.
- **Type pairing is on brand.** Headings resolve to the VAG Rounded stack and UI text to Avenir Next, as the guideline suggests, with sensible fallbacks.
- **Information architecture is sound.** `shellNavigation` groups destinations by Today / Franchise / Commercial / Publishing / Marketing / Finance / Administration, every link is permission-gated server-side, and the active item is marked with `aria-current`.
- **The card pattern is consistent.** Eyebrow → heading → one-paragraph intro → KPI tiles → list is used everywhere, so pages are predictable.
- **Empty states exist on most operator pages** ("Nothing is waiting for a decision", "No critical actions").
- **Explanatory copy is often excellent.** The Roles page ("you can never give out more access than you hold yourself") and the finance assistant ("a flag is a question to ask, not a finding") are the right tone for a franchise network.
- **Mobile basics pass.** No horizontal overflow on the app or the public site; the sidebar collapses behind a Menu button.
- **The public area site looks like Raring2go.** Warm gradient hero, big rounded headline, pill tags and the yellow magazine band read as family, local and friendly.

## Findings

Ordered by impact. P1 blocks "delivers", P2 is navigation, P3 is visual polish, P4 is copy.

### P1 — Must fix

1. **No way to sign out or see who you are from inside the app.** The shell (`apps/web/app/(app)/layout.tsx`) has no account menu; the only link to `/sign-out` in the codebase is in the sign-in help text. Users have to know the URL.
2. **The design system is not used by the product.** `@raring2go/ui` is imported only by `apps/web/app/design-system/*`. All 54 app pages use ad-hoc classes (`app-panel`, `franchise-list`, `franchise-actions`, `status-badge` …) from a 1,759-line `globals.css`. This contradicts the AGENTS.md rule to reuse design-system components, and it means the purple focus ring, density modes, badges, tabs, data table and command palette never reach a user. Today the only element with a branded focus ring is the sign-in email field.
3. **Raw identifiers and enum values are shown to people.** Examples seen: "Territory 00000000-0000-4000-8000-000000000101" in the My Today attention queue; the Franchisees list uses the organisation UUID as the title; "active - trading", "pending_review", "missing_image", "Autumn 2026 - Planning - watch". These need a presentation layer (directory lookups for names, label maps for statuses).
4. **Dead ends are unbranded or missing.** There is no `not-found.tsx`, `error.tsx` or `loading.tsx` anywhere under `apps/web/app`. An unknown route shows the stock Next.js "404 This page could not be found". A permission refusal renders "UNAUTHORISED / Access denied / No permission grant matched this request" outside the shell, with no navigation and no way back.
5. **Placeholder screens are in the live navigation.** "Territory Dashboard" renders "Territory workspace placeholder"; "System" renders "System administration placeholder". Thirteen page files still contain the word placeholder.

### P2 — Navigation and wayfinding

6. **The sidebar is a flat wall of text links.** Super Admin sees 31, the Franchisee 27, with no icons, no collapsing, no search and no pinning. The command palette that already exists in `packages/ui` is not wired to the shell; "Search" is a page rather than a shell control.
7. **Every operator page has the same browser title**, "Raring2go Business-in-a-Box". Only the public `/areas` pages export per-page metadata. Tabs, history and bookmarks are indistinguishable.
8. **The top bar repeats itself.** It shows display name, organisation, territory and then a row of context pills that repeat the same organisation name. Pills have no "current" state and no label explaining they switch context. The Franchisee fixture also surfaces test contexts ("Journey Tests (do not use)").
9. **Breadcrumbs appear only on some detail pages** (Advertiser 360 has them; Franchisee 360 and edition pages were not consistent). The sidebar `h1` is "Business-in-a-Box" on every page, so the real page title is an `h2` inside a card.
10. **Label vocabulary is mixed.** "My Today", "Territory Dashboard", "Commercial Command", "Marketing Command", "Edition Factory", "Newsletter Factory", "Franchisee 360", "HQ Control Room". "Scorecard" sits under Franchise but routes to `/app/analytics`. A Franchisee opening Edition Factory is greeted with "HQ Control Room".

### P3 — Visual polish

11. **No logo, favicon or app icon.** The brand mark is the text eyebrow "RARING2GO!" set in Avenir; guideline sections 1.1–1.3 define a logo with clear-space rules. There is no `icon.*` or `opengraph-image` in `apps/web/app`.
12. **Layout wastes the desktop.** Content is capped at 760–920 px inside an 1160 px workspace at 1440 wide, leaving a large empty right gutter, and every page is the same vertical stack of white cards. Page title, intro and primary action live inside the first card rather than in a page header.
13. **Action hierarchy is flat.** Rows of three identical gradient buttons ("Open pipeline / View catalogue / Commercial command") give no primary/secondary cue, while some real actions are bare `<Link>`s rendered in browser-default blue ("Draft new content with AI", "Open HQ newsletter factory"). There is no global link colour rule.
14. **Status has no colour.** KPI tiles and list rows are monochrome: "Editions at risk 1" and "0/36 pages ready" look the same as healthy numbers. Seasonal accents, which the design system reserves for editions, are not used on edition cards.
15. **Small details.** Dates render as ISO ("2026-08-10") rather than en-GB; nav group labels are 11.5 px; body copy is 14 px muted grey on a light grey page, which passes contrast (≈5.5:1) but makes the whole UI feel grey-on-grey.
16. **Public site on mobile.** The hero has roughly 400 px of empty gradient above the eyebrow; the section nav wraps to three lines with no menu; the home page stacks empty headings ("What's on near you", "Things to do") with nothing underneath instead of a designed empty state.

### P4 — Copy and tone

17. **Internal language leaks to users.** Operator pages: "Canonical operating relationships linking franchise organisations, territory ownership and platform users", "Native audience foundation", "System-scope access is represented by permissions, not by hard-coded role names in the application shell", "A role-aware operating view". Parent-facing pages: "Find approved local family events without exposing draft editorial work or unpublished listings", "Consent is recorded in the native audience model", "Published digital editions will appear here when production output is ready for public release". The brand voice is warm and local; the product voice is a build spec.
18. **Greeting uses the first token of the display name**, so a fixture renders "Super, here is what needs attention". Fine for real names, but worth a fallback.

## Recommended plan

Each item is a small, reviewable ticket in the repo's existing style.

1. **Shell sprint (P1 1, 4, 5; P2 6–9).** Add the logo and favicon; an account menu (name, role, active context, sign-out); `generateMetadata` per page; `not-found.tsx`, `error.tsx` and an in-shell unauthorised page with a "back to My Today" action; collapsible nav groups with icons; wire the existing command palette to global search on ⌘K; hide placeholder destinations behind their feature flag until they ship.
2. **Adopt `@raring2go/ui` in the product (P1 2).** Migrate one vertical first (Advertisers: list, 360, pipeline) from `app-panel`/`franchise-*` classes to Card, KPI, Badge, Tabs and DataTable, then delete the duplicated CSS. Focus rings, density and consistent badges come for free.
3. **Presentation layer (P1 3; P3 15).** A small `format.ts` in `apps/web/lib` with status label maps, en-GB date and money formatters, and territory/organisation name resolution through the existing directory. Add a test that no page renders a UUID as text.
4. **Visual hierarchy pass (P3 12–14).** Page header outside the card (title, one-line intro, single primary action right-aligned, secondary actions as outline buttons); status colours on KPI tiles via the semantic tokens; seasonal accent on edition cards; a global brand link colour.
5. **Copy pass (P4; P3 16).** Rewrite intros in the brand voice for two audiences: operators ("Who is advertising with you, and what needs chasing") and parents (no mention of drafts, consent models or production output). Design proper empty states on the public home page and fix the mobile hero padding and nav.
6. **Role-aware headings (P2 10).** Edition Factory, Newsletters and Finance should pick their heading from context ("Your Autumn 2026 edition" for a franchisee; "Network production status" for HQ).

## Status after the shell sprint (2026-10-09, branch `feature/shell-sprint`)

All five P1 findings are addressed, and the shell items from the P2 list that fit the sprint:

| Finding | Status |
| --- | --- |
| P1 1 No sign-out or account control | Done. Account menu in the top bar (name, context, Search, Sign out, Sign out of all devices); ⌘K palette also offers Sign out. |
| P1 2 Design system unused by the product | Done. Every operator page and companion panel uses `lib/page-ui.tsx` (PageHeader, Panel, Metrics, RecordList/RecordCard, StatusBadge, EmptyState, Notice, FilterTabs, FactList, Table, Actions). Second pass completed 2026-10-10. |
| P1 3 Raw identifiers and enum values | Done. Statuses, kinds and dates go through `lib/format.ts`; territory, organisation and user ids resolve to names through the directory. Identifiers people search or type (permission codes, job ids, audit action codes, tax-rate codes) are shown deliberately as code under a formatted label. |
| P1 4 Unbranded dead ends | Done. Branded `not-found.tsx` and `error.tsx`; refusals render inside the shell with a way back; unauthenticated requests go to sign-in. `loading.tsx` is deliberately not added: pages render the shell themselves, so a route-level loader would blank the navigation on every transition. Moving the shell into the layout is the prerequisite. |
| P1 5 Placeholders in nav | Done. Territory Dashboard removed from the nav (route redirects to My Today); System is now an administration hub with a health link. |
| P2 6 Flat wall of links | Done. Collapsible groups with icons; the active group stays open; ⌘K quick navigation. |
| P2 7 One browser title | Done. Every page exports a title, templated as "Page · Raring2go!". |
| P2 8 Repetitive top bar | Done. One context control (switcher when there is a choice) and one account control. |
| P2 9 Breadcrumbs / heading levels | Done. Every page has one `h1` from PageHeader; every record page has breadcrumbs back to its list. |
| P2 10 Label vocabulary | Not started (needs a naming decision). |

## Notes for the next reviewer

- Dev sign-in creates a session directly in non-production, so `/sign-in` with a fixture address is enough to reproduce every screenshot.
- The browser tool's viewport scales down; computed widths were checked with `getBoundingClientRect` rather than from pixels.
- Seed data (test contexts, fixture display names) explains some oddities and is not a design defect, but it does make the context switcher look untidy in demos.
