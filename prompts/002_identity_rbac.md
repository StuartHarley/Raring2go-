# Codex Task 002 - Identity and Editable RBAC

Read `AGENTS.md`, `docs/BUILD_SPEC.md`, and `docs/RBAC_MATRIX.md`.

Implement IAM-001 through IAM-003. The key requirement is that permissions are stored/evaluated as data: module + action + scope + constraints. Do not encode product behaviour with `if role === 'franchisee'` where a permission policy can express it.

Create role-aware application shells for Parent, Advertiser, Franchise Staff, Franchisee, HQ and Super Admin. UI hiding is not sufficient: server-side mutations and reads must enforce organisation/territory scope.

Add automated tests proving a user in Territory A cannot read or mutate Territory B records without explicit access. Seed the default roles but make their policies editable.
