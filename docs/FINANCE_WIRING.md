# Finance wiring (ADV-005, ADV-006)

## Accounting hand-off
- Issuing an invoice or credit note creates one `advertiser_provider_sync_references` row (type `accounting`, status `pending`) **in the same transaction**, so an issued document can never be missed.
- Durable job `finance.sync_accounting` (enqueued from the minute tick, one per five-minute bucket) leases due references in a single skip-locked statement, calls the provider with no transaction open and a stable idempotency key (`invoice:<id>` / `credit:<id>`), then records the answer.
- Failures retry with exponential backoff (5 min doubling, cap 6 h). After 8 attempts the reference is `failed` and stops; `/app/finance/accounting` shows it with the last error and a **Retry now** button. A `synced` reference is final.
- The accounting system is **Xero**, connected per franchise (`docs/XERO.md`). Development and tests use the deterministic provider when a franchise has no Xero connection. **In production a franchise with no connection waits** (visible on `/app/finance/accounting`, no attempt spent, retried every 6 hours and sent as soon as it connects); nothing is ever shown as synced that was not.

## Tax configuration
- Rates live in `advertiser_tax_rates` (code, basis points, effective dates). Invoices are priced with the rate in force on the issue date; an unconfigured code is an error, never a guess.
- New permission `advertiser.tax_rate.manage` (network scope, granted to HQ admin). A change **adds** a rate from a later date and closes the previous one the day before; rates are never rewritten.

## Database guarantees (migration 0049)
- Issued invoices: number, parties, dates, totals and snapshots are frozen; only status, paid, balance and voiding may change; never deleted. Their lines are frozen too (lines may be written while the invoice is being created in the same transaction).
- Credit notes, credit note lines and payment allocations are append-only. An accepted proposal acceptance is frozen (the booking it created may be attached once).
- CHECK constraints: invoice totals add up and paid + balance never exceed the total; payment allocated + unallocated equals the amount; a provider payment must carry its provider event id (the unique index on provider + event id makes duplicate payment events impossible). Constraints are `NOT VALID` (new/changed rows only); run `ALTER TABLE ... VALIDATE CONSTRAINT ...` once historical rows are reviewed.
- Tests that must delete real issued rows use `withFinanceGuardsDisabled` (test support only).

## Migration/seed impact
Run `pnpm db:migrate` then `pnpm db:seed` (new permission).
