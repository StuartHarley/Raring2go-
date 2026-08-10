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
