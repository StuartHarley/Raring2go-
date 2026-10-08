import { createFixtureIdentity, setIdentityForTests } from "./lib/auth-runtime";
import { fixtureDirectory, setDirectoryForTests } from "./lib/directory";
import { setFixturePermissionData } from "./lib/permission-source";

// Unit tests are deterministic: identity, names and authorisation come from the seeded fixtures, not
// whatever a developer last changed in their local database. Tests of the database-backed paths opt out
// explicitly (setDatabase... / setIdentityForTests(undefined) / setDirectoryForTests(undefined)).
setFixturePermissionData();
setIdentityForTests(createFixtureIdentity());
setDirectoryForTests(fixtureDirectory);
