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
