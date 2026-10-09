# Provider Failure Drills (UAT-004)

Two kinds: the automated drill (always runnable) and live drills (with real providers in a staging or pilot environment).

## Automated drill

```bash
pnpm drill:providers
```

Needs `DATABASE_URL` for a migrated and seeded database. It runs 13 scenarios, each with a provider forced to fail
against the real database, and prints a table. Expected behaviour in every scenario: **no silent data loss, no duplicate
consequential action, and an operator can see the failed record and the next step.** Attach the output to the sign-off.

| Provider | Failure forced | What must hold |
| --- | --- | --- |
| Email (Postmark, Microsoft) | Rejection, outage, token failure | Recorded as a recoverable failed delivery; retry resumes safely |
| Reminder emails | Send fails | Reminder stays scheduled and goes on the next run |
| Social (Meta) | No/invalid connection; worker dies mid-publish; two workers race | Fails closed; outcome-unknown is flagged for a person; exactly one post |
| Accounting | Down; absent in production | Retried with backoff then stopped and visible; nothing marked synced |
| E-signature | Fetch fails; untrusted host; checksum or type wrong; duplicate or out-of-order events | Nothing recorded on failure so the provider's retry works; refused files are never stored; each event applied once |
| Storage / scanner | Infected, tampered, not cleared | Nothing stored or downloadable |
| Alert webhook | Chat webhook down | The alert stays pending and is sent on the next tick |

## Live drills (staging or pilot, with real providers)

Run each one, record the result in `docs/UAT_EVIDENCE.md`, then restore the setting. Do not run these in production
during working hours without telling the product owner.

1. **Email down:** set `POSTMARK_SERVER_TOKEN` to an invalid value; send a test newsletter to an internal list. Expect: sends fail visibly (Job Console, `/app/marketing-command` send exceptions), no half-sent state. Restore the token and retry the failed job; recipients get one copy each.
2. **Meta token revoked:** revoke the app's access on the test Page. Expect: scheduled post fails with a reconnect prompt, nothing claims it posted. Reconnect, retry from the post. Verify the Page shows exactly one post.
3. **Storage unavailable:** point `R2_BUCKET` at a missing bucket. Expect: uploads refused with a clear message, no document record created. Restore; upload again.
4. **Scanner down:** stop the scanner or change `CLAMAV_SCANNER_API_KEY`. Expect: uploads refused (not stored unscanned). Restore; upload again.
5. **Webhook replay:** resend the same Postmark or e-signature webhook twice from the provider dashboard. Expect: second delivery acknowledged and ignored (no duplicate effect).
6. **Alerting:** change `ALERT_WEBHOOK_URL` to your test channel and cause a degraded state (for example set `ALERT_WEBHOOK_URL` unreachable first to see the failure retry; then fix and watch the alert arrive; then recover and watch the recovered message). Expect one alert, then a single recovery message.
7. **Job retry exhaustion:** make a job kind fail repeatedly (for example the accounting hand-off with no provider in a production-like environment). Expect: it stops after its attempt limit, appears as needing attention, health goes degraded, an alert is sent, and **Retry** works after the fix.
8. **Database restore:** follow `docs/BACKUP_RESTORE.md` into a new branch; record duration and checks.

Pass criteria for each: the failure is visible to an operator without reading logs, nothing is lost or duplicated, and
recovery needs no database edits.
