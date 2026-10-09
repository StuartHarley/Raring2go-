# Social publishing (MKT-005)

Staff queue approved content variants at `/app/social`, approve them, and schedule them in UK time. A durable job
(`social.publish_due`) publishes what is due.

## How a post moves

`draft` -> `approved` -> `scheduled` -> `publishing` -> `published`, or `failed`, or `cancelled`.

- Queuing needs an approved variant with an approved version, and an account in the same territory and channel. One queued post
  per variant per account.
- Scheduling needs approval first and refuses a time in the past. The form takes UK wall-clock time and converts it correctly
  across the clock changes (`apps/web/lib/london-time.ts`).

## Why publishing is in three steps

Posting twice to a public page is worse than posting late, so the worker never lets a crash cause a silent repeat:

1. **Claim** due jobs in one SQL statement (`for update skip locked`, so two workers never take the same job) and move each post to
   `publishing`, committed.
2. **Call the provider** with no transaction open.
3. **Record the answer.**

If the worker dies between 2 and 3, the post stays `publishing`. After 15 minutes the reaper marks it failed with reason
`outcome_unknown`. It is **never retried automatically**. A person checks the page, then either records it as posted (with the
post link) or queues it again.

## Failures

- A recoverable failure (provider outage, rate limit) retries after 5, 10, then 20 minutes, up to the job's attempt limit.
- An unrecoverable failure (bad credentials, wrong account, unsupported channel) fails straight away. Staff can "Try again".
- Tokens and secrets are stripped from anything the provider returns before it is stored.

## Providers

- **Facebook pages:** the Meta adapter, using the page connection from Settings > Connections. The page token is read from the
  encrypted secret store at publish time and never leaves the adapter.
- **Instagram, LinkedIn:** no adapter yet; posts for these fail closed with `unsupported_channel`.
- **No real connection:** development uses a deterministic provider that posts nothing. In production the same account fails
  closed (`no_connection`), so nothing is reported as posted that was not.

## Tests

`apps/web/lib/social-runtime.test.ts` runs the whole chain on Postgres, including two workers racing over the same due posts
(each post published once), production fail-closed, a worker that died mid-publish, and cancellation while waiting.
