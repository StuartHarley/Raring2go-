# Advertiser Portal (EXT-001)

An advertiser's own login to see and act on their account: proposals, bookings, artwork, proofs, invoices, results and renewals. `/app/portal` ("My Campaigns").

## Who can see what (tenancy)

- **Identity is derived on the server.** `resolvePortalIdentity` takes the verified session's user and active organisation, requires that organisation to be an `advertiser`, and returns the closed set of advertiser ids belonging to it. Nothing about the account's scope is accepted from the browser. An unlinked login, or a staff user, is refused outright.
- **The portal runtime does not trust membership alone.** It checks the `portal.advertiser.view` grant itself (the staff fixture user is a member of the advertiser organisation but has no portal grant). Every action also re-derives identity inside its own transaction.
- **A hardened domain rule.** The commercial domain's access check was territory-only, which cannot restrict an advertiser login (it has no territory). `ensureContextCanAccessAdvertiser` now also refuses an actor from an advertiser organisation on any other advertiser's records (`Advertiser is outside your organisation.`), for every domain function.
- **Same error for "missing" and "not yours"** on artwork requirements and proposals, so ids cannot be probed across accounts.
- **Read model is an allow-list DTO** (`buildPortalView`). Internal pricing/margin notes, opportunity and scoring data, account owner, tags, commercial metadata, other advertisers' data, draft invoices, draft proof packs and voided invoices are never copied in (asserted by tests that search the serialised view for planted internal markers).
- The advertiser's sign-in lands directly on the portal and their navigation contains only "My Campaigns".

## What it shows

Proposals with status, validity and items; campaigns (booking, items, fulfilment status); artwork per booking with every submitted version; issued proof packs and their numeric results; invoices with issue/due dates, total, paid, balance, overdue flag, payments applied and credit notes; open renewals; and a "Needs your attention" list (proposals to answer, artwork to send, proofs to approve, overdue invoices).

## What the advertiser can do

| Action | Rule |
| --- | --- |
| Accept a proposal | Creates the booking, items, inventory reservation and production requests in one transaction. Only a `sent`, unexpired, current proposal; needs approved terms and a contact linked to the login (`advertiser_contacts.user_id`). Idempotent: repeating returns the original acceptance. |
| Decline / ask for changes | Records the response; no booking. |
| Send artwork | PDF/PNG/JPEG/TIFF, up to **4MB** through the app (serverless body limit; larger print files need the direct-to-storage flow once the real storage provider is configured). Ownership and state are checked **before** the file is stored; the file goes through the normal storage and malware scan and is held against the advertiser's own organisation; only `clean`/`not_required` files can be submitted. Numbered versions; blocked while a version is under review. |
| Approve a proof / request changes | Only when a proof has been issued (`in_review` with a proof reference). The two advertiser outcomes are an allow-list; "production ready" is Raring2go's and cannot be granted from the portal even though the domain's coarse capability would allow it. |

Not offered yet: online card/Direct Debit payment (no payment provider is configured; the page says how to pay) and campaign self-booking from the catalogue (bookings come from accepting proposals). Both are honest gaps, not hidden.

## Persistence: `persistAdvertisingChanges`

The advertising domain functions mutate an in-memory `AdvertisingData` and had no write path in the app. `@raring2go/advertising` now has a generic, tested persister: load the data, snapshot it, run the domain function, then `persistAdvertisingChanges(tx, before, after)` inserts new rows (parents before children) and updates **only the columns that changed**, so unrelated concurrent edits are not clobbered. Dates are converted by column type; a domain function removing a row throws (records are soft-deleted). Domain-generated child ids can now come from an injectable `newId` (they were `${prefix}_${n}`, not valid UUIDs). Staff write paths can reuse the same pattern.

## Permissions, seed and migration impact

New role `advertiser` (`…0305`), user `advertiser@example.raring2go.test` (`…0204`, linked to the seeded advertiser contact), permission `portal.advertiser.view` (`…0558`) plus the artwork/proposal/booking capabilities at `own_organisation` scope. Membership and role assignment seeded. **No migration.** Re-run `pnpm db:seed`.

## Tests

Pure: `packages/advertising/src/portal.test.ts` (isolation, DTO stripping, every action and refusal) and `persist.test.ts`. Real Postgres: `apps/web/lib/portal-runtime.test.ts` (accept a proposal, artwork, staff-issued proof, approval, membership-is-not-access); shell tests prove the advertiser sees only the portal.
