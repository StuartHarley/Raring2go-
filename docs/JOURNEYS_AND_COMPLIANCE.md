# Journeys and compliance jobs (MKT-006, FRN-006)

Both run as durable jobs in the job runtime (visible in the Job Console, retried, dead-lettered), enqueued on each worker tick.

## Journeys: `marketing.run_journeys`

Each run does two things: **scan** for people who should enter trigger-based journeys, then **run every step that is due**.
The old `/api/jobs/journey-execute` route stays for operators and runs the same code.

### Who enters

| Trigger | Found by | Entered |
|---|---|---|
| `contact_subscribed_to_territory` | subscriptions made in the last 3 days, any route | once per subscription |
| `contact_inactive` (days) | subscribed contacts with no activity and no subscription within the window | once per 180 days |
| `digital_edition_published` | a digital edition published in the last 14 days | once per edition per contact |

A journey's **conditions** are evaluated at entry; someone who does not meet them is not entered. Suppressed or unsubscribed
contacts are never entered. Re-running the scan, or two overlapping runs, enters no one twice (idempotency keys). A scan enters at
most 500 people per run.

### What may be sent

Before each email step the engine checks `evaluateSendFrequency`:

- **Journey cap** (always): `{ maxPerContact, window: "lifetime" | "24h" | "7d" | "30d" }`. A journey with no valid cap gets
  3 emails per 7 days, so nothing is uncapped by omission.
- **Parent preference** (not for `transactional` steps): a parent who chose weekly, fortnightly, monthly or school-holidays-only
  email is not emailed more often than that (7, 14, 30, 30 days), counting newsletters as well as journeys.

A step blocked by either is **skipped**, not sent: the step is recorded as `skipped` with the reason and the journey moves on.
Counts come from recipient snapshots (what was actually queued), ignoring sends whose job failed.

### Named journeys

`journeyTemplates` defines the starting drafts: **welcome**, **re-engagement** (two emails a week apart) and **digital magazine**.
A template is only a draft; it still goes through approval and activation. Local event digest, competition follow-up, sponsored
campaigns and school-holiday countdowns are not defined because their triggers (competition entries, a holiday calendar,
advertiser campaign events) do not exist yet.

Sending the queued emails is still the separate `email-send` cron route.

## Compliance: `franchise.compliance_daily`

1. Create compliance actions (and their first reminder) for every active franchise's missing, expiring, expired or rejected requirements.
2. Add one **overdue** reminder for any action still open a week after its due date.
3. Email each reminder that is due to the franchise's primary owner.

Delivery is **at least once**: the email goes first, then the reminder is marked sent with a conditional update, so a crash can repeat
a reminder but never lose one, and two runs cannot both settle it. A reminder for a requirement that has since been resolved is
cancelled, not sent. One that cannot be delivered for two weeks (or has no recipient) is cancelled and audited so it is not retried forever.
