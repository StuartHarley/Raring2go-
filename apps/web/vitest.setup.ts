import { setFixturePermissionData } from "./lib/permission-source";

// Unit tests are deterministic: authorisation comes from the seeded grants, not whatever a developer
// last edited in their local database. Tests of the database-backed path opt out explicitly.
setFixturePermissionData();
