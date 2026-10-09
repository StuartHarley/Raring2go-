# Parent self-service (EXT-002, MKT-007, PUB-005)

A parent signs in with an email link (see `AUTH.md`) and manages their own record at `/areas/<area>/preferences`,
`/areas/<area>/saved` and the save buttons on What's On and Activities.

## Rules

- **The contact comes from the session.** Server actions never accept a contact or user id. `asParent` in
  `apps/web/lib/parent-runtime.ts` resolves the signed-in parent, then runs the change in one transaction with its
  consent and audit rows. A parent cannot reach another parent's record.
- **Following is not consent.** Following an area and choosing interests is personalisation (preference profile). Email
  consent is a separate, explicit per-area subscription.
- **Consent changes take effect immediately.** Subscribing/unsubscribing flips the territory subscription that segment
  eligibility reads and writes an `email_marketing` consent event (`source: parent_account`). Repeating the same choice
  records nothing. `parent-self-service.integration.test.ts` proves a parent enters and leaves a real audience.
- **Opt out of all email** creates an active `parent_opt_out` suppression. Opting back in lifts only suppressions the
  parent could have created (`parent_opt_out`, `recipient_unsubscribe`); bounces, complaints and staff suppressions stay
  active and the page tells the parent we cannot email them.
- **Data minimisation.** Only broad age bands and short interest words are accepted; free text is limited to 20 items of
  40 characters. No child names or dates of birth.
- **Creating a parent contact grants no consent.** First sign-in creates a contact (one conditional insert, safe under
  concurrent first visits) with no subscriptions.

## Not covered here

Anonymous newsletter signup (needs a confirmed double opt-in email) and public detail pages with a save button belong to
the public-site package.
