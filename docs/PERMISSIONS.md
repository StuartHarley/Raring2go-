# Permissions Foundation

IAM-002 establishes a default-deny, data-driven permissions evaluator in `@raring2go/permissions`.

Permissions are always evaluated as module + action + scope. Broader scope determines where a specific permission applies; it never grants additional actions. Role names are editable data and must not be hard-coded into authorisation logic.

## Server Boundary

Server code should call `evaluatePermission` or `requirePermission` before sensitive reads or writes. UI helpers such as `canShow` are derivative convenience helpers only and are not a security boundary.

## Scope

Supported scopes are `public`, `own_record`, `own_organisation`, `organisation`, `own_territory`, `territory`, `selected_territories`, `network` and `system`. Unknown scopes fail closed.

## Constraints

IAM-002 keeps constraints deliberately small and authorisation-focused:

- allowed territory IDs;
- denied territory IDs;
- explicit owner user ID;
- require current user to own the resource;
- visible field masks.

Malformed or unknown constraints fail closed.

## Caching

Production code defaults to `noPermissionCache`. A cache interface exists for future optimisation once invalidation is proven for role, assignment and delegation changes.

## Audit

Role, permission assignment and delegation changes should write audit events using the `permission.*` action names in `@raring2go/audit`.

## Runtime: permissions come from the database (IAM-002)

The evaluator is only half of IAM-002; this is the other half.

- **One source of truth.** Roles, grants (`role_permissions`: module, action, scope, constraints) and assignments (`user_role_assignments`: user, role, organisation, territory, optional dates) live in Postgres. `loadPermissionData` (`@raring2go/permissions`) reads them into the evaluator's shape; the web app obtains them only through `apps/web/lib/permission-source.ts`. Navigation, pages, server actions, route handlers and background services all check against the same data. There are no per-feature copies.
- **Cached briefly.** Each server instance caches the data for 15 seconds (`PERMISSION_CACHE_TTL_MS`). A change made through the admin screen takes effect immediately on that instance and within the TTL on others, so the TTL is the longest a revoked grant can keep working. A load that fails is never cached, and an expired copy is never served in place of a failed refresh: unavailable authorisation data denies, it does not quietly honour old rights. A load that was in flight when a change was made is discarded.
- **Defaults.** `packages/db/src/fixtures.ts` (`fixtureRolePermissions`, `fixtureRoleAssignments`) is the single definition of the default grants. `pnpm db:seed` inserts them with `ON CONFLICT DO NOTHING`, so it adds missing defaults but never overwrites or removes what administrators changed. (It will re-add a default grant an administrator deliberately removed: do not run the fixture seed against a production database.)
- **Unit tests** run against the same defaults in memory (`fixturePermissionData()`, installed by `apps/web/vitest.setup.ts`), so they are deterministic and need no database.

## Role administration (`/app/roles`)

Permissions: `roles.view`, `roles.manage` (create roles, change what a role holds), `roles.assign` (give and end roles), `roles.invite` (invite people). Super Admin holds all four at system scope; HQ Admin holds view, assign and invite at network scope.

Safety rules, enforced by the service (not the page) and covered by unit and Postgres tests:

1. **You cannot give out access you do not hold.** Adding a grant to a role needs the same capability at least as widely. Giving someone a role needs, for every grant in it, the ability to exercise that capability on that organisation and territory, at least as widely as the role grants it. A network administrator cannot hand out a system-level role.
2. **System administrators are exempt** from rule 1 (`roles.manage` at system scope is what Super Admin means), because Super Admin does not hold every capability personally.
3. **Built-in roles** can only be edited by a system administrator, and cannot be deleted.
4. **An administrator always remains.** Ending an assignment or removing a grant that would leave no active account with `roles.manage` at system scope is refused, and the transaction is rolled back.
5. **History is kept.** Ending a role sets its end date; it is not deleted. Custom roles are soft-deleted only when nobody holds them.
6. Every change is audited (`permission.role.*`, `permission.assignment.*`, `auth.invite.*`); invitee addresses appear in the audit trail only as a hash.

The page also has a **"why can or can't they?"** checker that shows the evaluator's own explanation for a person, capability and place.

### Franchise staff

Franchisees manage their own team through `/app/team` using the built-in Franchise Staff role: see `docs/FRANCHISE_STAFF.md`.
