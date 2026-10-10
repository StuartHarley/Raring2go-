# Advertiser CRM: opportunity scores and tasks

## Opportunity score (definition 2026.10.1)

Every open opportunity gets a score from 0 to 100, **worked out when it is viewed, never stored**, so it always reflects today. A won or lost opportunity has no score. The pipeline page ranks the top ten ("Where to spend today"), and every score can be opened to show each factor and its points. The score is advice for the salesperson, not a decision: nothing is blocked or sent automatically because of it.

| Factor | Points | How |
| --- | --- | --- |
| Stage | 0 to 35 | the opportunity's probability x 0.35 |
| Value | 0 to 15 | £5,000 or more 15; £2,000 or more 10; £500 or more 5; otherwise 0 |
| Recent contact | -15 to +15 | last recorded activity within 7 days +15; 14 days +8; 30 days 0; older -10; none -15 |
| Next step | -10 to +10 | planned today or later +10; overdue -10; none -5 |
| Expected close | -5 to +10 | passed -5; within 30 days +10; within 90 days +5; later 0 (omitted if no date) |
| Proposal out | +10 | a proposal has been sent to the advertiser |
| Existing customer | +10 | the advertiser has booked before |
| Overdue tasks | 0 to -10 | -5 for each open overdue task, to a maximum of -10 |

The total is clamped to 0 to 100. **Hot** is 70 or more, **warm** 40 to 69, **cold** below 40. "Recent contact" counts any activity recorded on the advertiser (calls, notes, meetings, emails, proposals, bookings). If the weights change, change `SCORING_VERSION` in `packages/advertising/src/scoring.ts` at the same time and update this table.

## Tasks

A task is a follow-up a person owes an advertiser (call, chase artwork, send a media pack), separate from an opportunity's single "next action". It has a title, an optional due date and notes, an assignee (the creator by default, or someone who holds a role covering the advertiser's territory) and optionally the opportunity it is about.

- Open, done, cancelled; done and cancelled tasks can be reopened. Every change is audited (`advertiser.task.manage`).
- Created, completed, cancelled and reopened from the advertiser page ("Tasks"); viewing needs access to the advertiser, changing needs the CRM edit permission, both checked on the server and scoped to the advertiser's territory.
- A user's open tasks that are due or overdue appear in **My Today**.
- Overdue open tasks lower the opportunity score, so neglected follow-ups surface.

## Check it (UAT)

1. On the pipeline page, add an opportunity with a value over £2,000 and no next step: its score is low, and the factor list says why (no contact, no next step).
2. Log a call on the advertiser: the score rises by 30 (recent contact from -15 to +15).
3. Add a task due last week: the score drops by 5 and the task shows in My Today as overdue.
4. Mark the task done: the penalty goes and the task leaves My Today.
5. As a franchisee in another territory, confirm you cannot see, add or change this advertiser's tasks.

## Not built

Automatic task creation from events (for example from a sent proposal), reminders by email, and bulk reassignment.
