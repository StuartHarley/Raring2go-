# Support Playbook (UAT-004)

For the front-line support owner during UAT and the controlled pilot. Technical diagnosis is in `docs/PILOT_RUNBOOK.md`.

## Channels and hours

Fill in before pilot: support inbox `<address>`, hours `<hours>`, out-of-hours emergency contact `<name, number>` (S0 only).

## Severity and response

Use the severity model in `docs/UAT_PLAN.md` ("Defect Severity and Triage"). Quick guide:

| Severity | Looks like | First response | Who is told |
| --- | --- | --- | --- |
| **S0** | Someone sees another territory's or advertiser's data; a secret exposed; money or legal records wrong; an uncontrolled bulk send or publish; platform down | Immediately: stop the affected activity, do not investigate alone | Technical incident owner and Product owner at once; data protection owner for any personal data |
| **S1** | A core journey cannot be completed and there is no safe workaround; nobody can sign in | Same day | Technical incident owner |
| **S2** | Important problem with a workaround | Within 1 working day | Product owner decides if the workaround is acceptable |
| **S3** | Wording, spacing, convenience | Backlog | Weekly review |

Security, privacy and tenancy problems are always handled as S0 first and reclassified later, never the other way round.

## Handling a report

1. **Acknowledge** within the target above and give the reporter a reference.
2. **Collect** (ask, do not guess): who (name, role, territory), what they were doing, what they expected and saw, when (time and time zone), the page address, a screenshot, and whether it happens again. Never ask for a password or a sign-in link; never accept one.
3. **Check the basics** from the runbook table: are they signed in to the right organisation and territory? Do they hold the role (`/app/roles`)? Is `/api/health` degraded? Is the job or record visibly failed (Job Console, command centres)?
4. **Log it** in the defect log (`docs/templates/DEFECT_LOG.md` or the CSV) with severity, owner and next update time.
5. **Fix or workaround**, then **confirm with the reporter** and record the retest. S0 and S1 fixes need explicit retest evidence of the whole affected journey.
6. **Close** only when the reporter has confirmed or two reminders have gone unanswered.

## Things support never does

- Never changes data directly in the database for a user. Ask the technical owner; every correction goes through the application so it is audited.
- Never shares one franchise's information with another, even to "help compare".
- Never bypasses a scan, approval or permission to unblock someone. Escalate instead.
- Never retries a social post marked "outcome unknown" without a person checking the page first.
- Never forwards personal data in an email chat or screenshot channel beyond the people named on the incident.

## Common questions

| Question | Answer |
| --- | --- |
| "I did not get a sign-in email." | Check spam; request again (a limit applies per address); an old link stops working once used. If they changed address, Head Office invites them at the new one. |
| "I lost my phone/laptop." | Sign in elsewhere and use **Sign out of all devices** (`/sign-out`). If they cannot sign in, escalate to the technical owner to disable and re-invite. |
| "I cannot see a page my colleague can." | Roles differ; check `/app/roles`. Do not copy someone else's access: ask Head Office to assign the right role. |
| "My newsletter has not gone." | `/app/marketing-command` shows send exceptions; scheduled sends go in the background within a few minutes of their time. |
| "An agreement shows as sent but not signed." | Signing happens with the e-signature provider; check the request status on the franchise page. Nothing is signed until the provider confirms it. |
| "I want something deleted." | Privacy requests are handled in `/app/privacy`; route to the data protection owner. |

## Escalation path

Support owner -> technical incident owner -> product owner. S0/S1 outside hours: emergency contact above. Record every escalation with time and person in the defect log.
