# Franchise Staff and "My team"

Decisions (from `docs/DECISION_BRIEFS.md`, approved): fixed **Franchise Staff** role; the franchisee invites and removes their own
staff for that role only; default seat limit 10; Head Office is told by the audit trail only; a franchise that is suspended or leaves
takes its team's access with it; staff cannot see the audit trail; no separate financial-visibility switch.

## The role (`franchise_staff`, built in, flagged `franchise_delegable`)

All grants are `own_territory`. Staff **can**: view and edit advertisers, contacts, activity and opportunities; view catalogue, artwork,
fulfilment, proofs and renewals; draft (not send) proposals; create and edit content and upload files; view editions; view the audience and
segments; draft newsletters; draft social posts; view the franchise, compliance and onboarding obligations; see and complete their own tasks.

Staff **cannot**: send a proposal, book, invoice, record payments or credits, see finance or royalties, approve/schedule/send emails,
approve/schedule/publish social posts, approve content or editions, see agreements or documents, see roles or the audit trail,
or manage people. (A new permission, `advertiser.proposal.send`, separates sending from drafting; franchisees and Head Office hold it, staff do not.)

## How delegation works

- Two permissions, `franchise.team.view` and `franchise.team.manage`, held by franchisees at own territory (not Head Office, who manage people at `/app/roles`).
- `/app/team` ("My team") lists staff and pending invitations, and invites, withdraws and removes. The franchise is taken from the signed-in session, never from the request.
- Only roles flagged `franchise_delegable` can be given, so a franchisee can never create another franchisee or a Head Office user. The existing "cannot grant access you do not hold" guard still applies on top.
- A franchisee never holds `roles.assign` or `roles.invite`, so they cannot reach the general role administration.
- Removal only works for delegable roles at the franchisee's own organisation and territory; for anything else the answer is the same "not on your team", so nothing is revealed about other franchises.
- Seat limit 10 by default (`FRANCHISE_TEAM_SEAT_LIMIT` overrides); re-inviting a pending address does not use another seat.
- Setting a franchise to `suspended`, `ended` or `archived` ends every staff assignment and withdraws pending invitations in the same transaction (`franchise.team.access_ended`). Reactivating does not restore anyone: access is granted afresh.
- Audit: `franchise.team.invite`, `.invite_revoke`, `.remove`, `.access_ended`, plus the standard invitation events (invitee address hashed).

## Migration and seed impact

Migration `0052` adds `roles.franchise_delegable`. Run `pnpm db:migrate` then `pnpm db:seed` (new role, three permissions, grants). Seeding does not remove grants, so an environment seeded earlier keeps nothing stale for this feature.

## Tests

`packages/access/src/franchise-team.integration.test.ts` (role contents and guard; invite/accept/permission evaluation in and out of territory; refused roles; seat limit; removal scope; leaver), `apps/web/lib/franchise-team.test.ts` (runtime and suspension), role-by-role page access in `apps/web/lib/page-access.test.ts`.
