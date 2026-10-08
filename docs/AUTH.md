# Authentication And Organisations

IAM-001 establishes identity, sessions, invitations and server-resolved working context. Auth.js is used behind `@raring2go/auth`; application/domain code should depend on Raring2go auth services and provider-neutral types rather than Auth.js concepts.

## Provider Strategy

The platform is passwordless-first. Email sign-in/invitations are the baseline, with OAuth/social providers suitable for future parent/public experiences and stronger enterprise/provider capabilities available later for HQ and Super Admin users.

Provider-specific Auth.js configuration belongs behind the `createAuthJsBoundary` abstraction. Raring2go user, organisation, membership, session and audit behaviour remains in local packages.

## Identity Model

`users.email` remains globally unique. A single user identity can act in multiple contexts through `memberships` and future scoped role assignments.

## Session And Working Context

Sessions identify the user and authentication assurance level. Active organisation and territory are resolved server-side from the requested working context, user membership and territory ownership. The active context is not permanently coupled to the core session row.

## Assurance

IAM-001 introduces `standard` and `mfa` assurance metadata. Full MFA enrolment/challenge flows are out of scope, but sensitive future actions can require a higher assurance level through server-side context resolution.

## Invitations

Invitations are token-hash based, expire, can be accepted once, and create active organisation membership on acceptance. Invitation acceptance writes an audit event.

## Rate Limiting

`createDevelopmentMemoryRateLimiter` is development/test only. Production should use the same `RateLimiter` interface with a shared durable store.

## Audit

Auth-sensitive actions should use `@raring2go/audit`, including sign-in, sign-out, invitation lifecycle, email verification, recovery, session revocation and security changes.


## Persistence and invitations (IAM-001/IAM-004 follow-up)

- **Identity lives in Postgres.** Users, memberships, sessions, one-time sign-in links and invitations are stored via `createDrizzleAuthRepository`, and auth audit events go to the real audit table. The previous in-memory store meant a sign-in link issued by one serverless instance could not be verified by another and every session vanished on restart.
- **At most once, by construction.** Using a sign-in link, accepting an invitation, creating a user and creating a membership are each a single conditional statement, so two simultaneous requests cannot both succeed. Using a link or accepting an invitation runs in one transaction with its audit event.
- **Disabled accounts lose access immediately**, including live sessions: every request re-checks that the user is active.
- **Parents self-register.** Anyone can sign in by email, which creates an account that holds no memberships and therefore no staff access. Staff and franchisees are *invited*.
- **Invitations carry a role.** An invitation names an organisation, optionally a territory and optionally a role. Accepting it creates the membership and grants that role scoped exactly as invited. Links are single-use, expire after seven days, and only a hash is stored; inviting the same person again for the same place and role replaces the earlier link.
- **Default context** is derived from the user's own memberships (oldest active organisation, and for a franchise its first territory). Names and territory lists come from the database through `apps/web/lib/directory.ts`.
- **Development sign-in** (`NODE_ENV` not production) still creates a session directly for any email, now as a real database session.
