# Raring2go Digital Product Design System

FND-002 establishes the shared design language for the Raring2go Business-in-a-Box platform. The authoritative brand reference is `docs/brand/R2GO_Brand_Guidelines.pdf`.

## Brand Source

- Primary brand colours: `#852890` and `#400044`, with a restrained identity gradient.
- Seasonal accents: Spring `#93c83e`, Summer `#56cbf5`, Autumn `#fbad18`, Winter `#e01a36`.
- Logo rules: do not distort, rotate or recolour the mark. The PDF is a reference for logo usage and clear-space rules, not a production logo asset source.
- Production-ready vector/logo assets should be added separately when supplied.

## Product Evolution

The product UI evolves the 2018 print identity into a premium 2026 operating system. Purple establishes identity in navigation, primary actions, selected states and key moments. Most working surfaces remain calm, clean and readable.

## Typography

The brand guide references Avenir, VAG Rounded and Franklin Gothic ITC. These are licensing-dependent and are not bundled. The product UI uses CSS font stacks that prefer licensed installs when present and fall back to common system fonts.

Magazine print typography is separate from application UI typography. Print sizes, two-column editorial rules, cover highlight boxes, footer conventions and copy-length guidance from pages 5-7 should become future magazine template metadata.

## Semantics

Seasonal colours are edition accents, not status meanings. Accessibility tokens such as `text-primary`, `text-muted`, `border-default`, `focus-ring`, `status-success`, `status-warning` and `status-danger` prevent Spring/Summer/Autumn/Winter from being misused as success/warning/error.

## Density

The system supports comfortable and compact density modes from the same components:

- Comfortable: creative/editorial workflows and parent-facing discovery.
- Compact: HQ, Super Admin, finance and operational tables.

## FND-002 Scope

This ticket provides presentational primitives only. Command palette behaviour, drag-and-drop magazine editing, permission enforcement and domain workflows belong to later tickets.

## Shell and page anatomy (shell sprint, October 2026)

The operator app consumes the design system through two layers:

- `packages/ui` holds the presentational primitives (`Button`, `Badge`, `Card`, `KpiCard`, `Tabs`, `DataTable`, overlays, `CommandPalette`) and the token stylesheet.
- `apps/web/lib/page-ui.tsx` composes them into the page anatomy every operator screen shares: `PageHeader` (eyebrow, one `h1`, intro, right-aligned actions), `Panel` (a `Card` with the `app-panel` layout), `Metrics` (a grid of `KpiCard`s coloured by meaning), `RecordList` / `RecordLink`, `StatusBadge`, `EmptyState` and `LinkButton`.

Rules that follow from it:

- Pages never render a status, date or identifier directly. `apps/web/lib/format.ts` turns machine values into words (`formatLabel`, `formatDate`, `formatCount`, `displayName`), and names come from the directory, never from a UUID.
- One primary button per page, in the page header. Secondary actions use the `secondary` or `quiet` variants.
- KPI tiles carry a tone (`danger` for blocked or failed work, `warning` for watch items, `success` when clear) so a number that needs attention looks different from a healthy one.
- Refusals render inside the shell through `ProtectedOutcome` so navigation and the context switcher stay available; `recordOutcome` sends a missing record to the branded not-found page.
- Every page exports a `metadata.title`; the root layout templates it as `<title> · Raring2go!`.

The shell itself (`apps/web/app/(app)/layout.tsx`) provides the brand mark, grouped collapsible navigation with group icons (`SidebarNav`), the working-context switcher and account menu (`Disclosure`, native `<details>` with outside-click and Escape handling), and ⌘K quick navigation over the permission-filtered destinations (`ShellCommandPalette`, built on the ui package's `CommandPalette`).

Every operator page under `apps/web/app/(app)/app` now uses the anatomy, including the companion panels (CRM, sales, fulfilment, finance assistant) and the advertiser portal. The only legacy classes still in use are the form grid (`franchise-form`), the attention list on My Today (`today-item`), purpose-built editors (`block-editor-*`, `segment-builder-*`, `newsletter-compose-*`, `journey-builder-*`, `edition-flatplan`) and `code-block` for payloads. New pages start from `PageHeader` + `Panel`; a grep for `className="app-panel`, `franchise-list`, `franchise-metrics`, `app-link-button`, `toLocale` or `.replace("_"` in a page is a review finding.

Values deliberately shown raw are identifiers people search or type: permission codes on the role page, job and correlation ids on the job page, audit action codes under their formatted label, and tax-rate codes needed to add a successor rate.

Brand assets: no production logo vector has been supplied yet. `BrandMark` and `app/icon.svg` are interim marks set in the brand colours and type stack; replace both when the logo files arrive, without touching pages.
