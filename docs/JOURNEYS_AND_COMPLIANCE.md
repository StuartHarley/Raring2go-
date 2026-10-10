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
| `school_holiday_approaching` (days before, 1 to 60) | a holiday in the HQ calendar that has not started and starts within that many days, for the subscriber's area | once per holiday per subscriber per area |
| `competition_closed` | a competition that closed in the last 14 days; each entrant who also subscribes to the area | once per competition per entrant |
| `weekly_digest` (weekday, 0 Sunday to 6 Saturday, UTC) | on that weekday, each area that has approved public events in the next 14 days | once per subscriber per area per ISO week; an area with no events gets no entries at all |

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
Three more are defined: **school holiday countdown**, **weekly local events digest** and **competition follow-up**. Start any of them from Journeys, "Start from a ready-made
journey"; a template is only a draft and still goes through approval and activation. Sponsored campaigns are **not** defined because their trigger (advertiser campaign events) does not exist yet.

### Content that changes: `[[tokens]]`

A journey whose message depends on what is happening fills in values when someone enters it. A step writes `[[holiday_name]]`,
`[[holiday_starts]]`, `[[holiday_ends]]`, `[[days_until]]`, `[[area_name]]` (school-holiday trigger) or `[[area_name]]`,
`[[local_events|html]]` (weekly digest) or `[[competition_title]]`, `[[area_name]]` (competition follow-up) in its subject, headings and text blocks. Rules:
- each trigger provides only its own tokens; a journey using any other is refused when it is created (the builder and the templates both check);
- plain values are escaped as they are filled in; the events list is built by our code and sanitised;
- each variant (this holiday in this area, this week's events in this area) gets its own campaign, so two holidays never share wording;
- if a value is missing, the step is **skipped** as `content_unavailable`, never sent blank. It is written `[[ ]]` so it can never be confused with the per-recipient `{{firstName}}`.

### The school holiday calendar

HQ maintains it at Journeys, School holiday calendar (permission `marketing.calendar manage`, audited): a name, first and last day, and an
optional area (blank applies to every area). With an empty calendar no countdown is sent. A parent who asked for **school-holiday email
only** is not held back by their email-frequency gap for a school-holiday countdown (it is exactly what they asked for); the journey's own
cap still applies, and every other journey is still held to their gap.

### Weekly digest details

Events come from the same approved public events the website shows (starting from today to 14 days ahead, up to five, soonest first),
linked to the public site (`NEXT_PUBLIC_SITE_URL` must be set in production, otherwise the digest is skipped and logged). The scan runs
daily; the digest is entered on the chosen weekday, so a missed day means that week's digest is missed, not sent late.

Sending the queued emails is still the separate `email-send` cron route.

## Compliance: `franchise.compliance_daily`

1. Create compliance actions (and their first reminder) for every active franchise's missing, expiring, expired or rejected requirements.
2. Add one **overdue** reminder for any action still open a week after its due date.
3. Email each reminder that is due to the franchise's primary owner.

Delivery is **at least once**: the email goes first, then the reminder is marked sent with a conditional update, so a crash can repeat
a reminder but never lose one, and two runs cannot both settle it. A reminder for a requirement that has since been resolved is
cancelled, not sent. One that cannot be delivered for two weeks (or has no recipient) is cancelled and audited so it is not retried forever.
