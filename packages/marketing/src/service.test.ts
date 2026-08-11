import { auditActions } from "@raring2go/audit";
import type { PermissionData } from "@raring2go/permissions";
import { describe, expect, it } from "vitest";
import {
  listAudienceContacts,
  previewSegment,
  recordConsentEvent,
  subscribeContactToTerritory,
  suppressContact,
  upsertAudienceContact
} from "./service";
import type { MarketingData } from "./types";

const ids = {
  users: { hq: "user_hq", local: "user_local" },
  organisations: { hq: "org_hq", franchise: "org_franchise" },
  territories: { own: "territory_own", other: "territory_other" },
  roles: { hq: "role_hq", local: "role_local" },
  contact: "contact_parent",
  segment: "segment_newsletter"
};

const permissions: PermissionData = {
  roleAssignments: [
    { id: "assignment_hq", userId: ids.users.hq, roleId: ids.roles.hq, organisationId: ids.organisations.hq },
    { id: "assignment_local", userId: ids.users.local, roleId: ids.roles.local, organisationId: ids.organisations.franchise, territoryId: ids.territories.own }
  ],
  rolePermissions: [
    grant(ids.roles.hq, "marketing.audience", "view", "network"),
    grant(ids.roles.hq, "marketing.audience", "manage", "network"),
    grant(ids.roles.hq, "marketing.consent", "manage", "network"),
    grant(ids.roles.hq, "marketing.segment", "view", "network"),
    grant(ids.roles.hq, "marketing.segment", "manage", "network"),
    grant(ids.roles.local, "marketing.audience", "view", "own_territory"),
    grant(ids.roles.local, "marketing.audience", "manage", "own_territory"),
    grant(ids.roles.local, "marketing.consent", "manage", "own_territory"),
    grant(ids.roles.local, "marketing.segment", "view", "own_territory"),
    grant(ids.roles.local, "marketing.segment", "manage", "own_territory")
  ],
  territories: [
    { id: ids.territories.own, franchiseOrganisationId: ids.organisations.franchise },
    { id: ids.territories.other, franchiseOrganisationId: "org_other" }
  ]
};

describe("marketing audience foundation", () => {
  it("deduplicates contacts by normalised email across multiple territories", async () => {
    const data = emptyData();
    const recorder = audit();

    const created = await upsertAudienceContact(hqContext(), permissions, recorder, data, contact("Parent@Example.Test"));
    const deduped = await upsertAudienceContact(hqContext(), permissions, recorder, data, {
      ...contact(" parent@example.test "),
      id: "duplicate",
      tags: ["offers"]
    });
    await subscribeContactToTerritory(hqContext(), permissions, recorder, data, subscription("sub_own", created.id, ids.territories.own));
    await subscribeContactToTerritory(hqContext(), permissions, recorder, data, subscription("sub_other", created.id, ids.territories.other));

    expect(deduped.id).toBe(created.id);
    expect(data.contacts).toHaveLength(1);
    expect(data.contacts[0]?.tags).toEqual(["days-out", "offers"]);
    expect(listAudienceContacts(hqContext(), permissions, data).totals).toMatchObject({
      contacts: 1,
      subscribed: 1,
      territories: 2
    });
  });

  it("records append-only consent history and suppressions exclude segment eligibility", async () => {
    const data = seededData();
    const recorder = audit();

    await recordConsentEvent(localContext(), permissions, recorder, data, {
      id: "consent_2",
      contactId: ids.contact,
      territoryId: ids.territories.own,
      consentType: "newsletter",
      action: "withdrawn",
      source: "preference_centre",
      occurredAt: "2026-08-12T00:00:00.000Z",
      actorUserId: null,
      evidence: { ip: "127.0.0.1" }
    });
    await suppressContact(localContext(), permissions, recorder, data, {
      id: "suppression_1",
      contactId: ids.contact,
      emailNormalised: "parent@example.test",
      territoryId: ids.territories.own,
      reason: "unsubscribe",
      source: "preference_centre",
      active: true,
      suppressedAt: "2026-08-12T00:00:00.000Z",
      metadata: {}
    });

    expect(data.consentEvents.map((event) => event.action)).toEqual(["granted", "withdrawn"]);
    expect(previewSegment(localContext(), permissions, data, ids.segment)).toEqual([]);
    expect(listAudienceContacts(localContext(), permissions, data).totals.suppressed).toBe(1);
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.marketingConsentRecord,
      auditActions.marketingAudienceSuppress
    ]);
  });

  it("fails closed for cross-territory audience changes", async () => {
    await expect(subscribeContactToTerritory(localContext(), permissions, audit(), seededData(), subscription("sub_cross", ids.contact, ids.territories.other))).rejects.toThrow("outside the active territory");
  });
});

function seededData(): MarketingData {
  const data = emptyData();
  data.contacts.push(contact("parent@example.test"));
  data.subscriptions.push(subscription("sub_own", ids.contact, ids.territories.own));
  data.consentEvents.push({
    id: "consent_1",
    contactId: ids.contact,
    territoryId: ids.territories.own,
    consentType: "newsletter",
    action: "granted",
    source: "signup",
    occurredAt: "2026-08-11T00:00:00.000Z",
    actorUserId: null,
    evidence: {}
  });
  data.segments.push({
    id: ids.segment,
    territoryId: ids.territories.own,
    key: "own-newsletter",
    name: "Own newsletter",
    segmentType: "dynamic",
    definition: { territoryId: ids.territories.own },
    status: "active"
  });
  return data;
}

function emptyData(): MarketingData {
  return {
    contacts: [],
    subscriptions: [],
    consentEvents: [],
    suppressions: [],
    segments: [],
    segmentMembers: [],
    imports: [],
    activityEvents: [],
    territories: [
      { id: ids.territories.own, franchiseOrganisationId: ids.organisations.franchise, name: "Own" },
      { id: ids.territories.other, franchiseOrganisationId: "org_other", name: "Other" }
    ]
  };
}

function contact(email: string) {
  return {
    id: ids.contact,
    email,
    emailNormalised: email.trim().toLowerCase(),
    firstName: "Pat",
    lastName: "Parent",
    emailStatus: "subscribed",
    tags: ["days-out"],
    metadata: {}
  };
}

function subscription(id: string, contactId: string, territoryId: string) {
  return {
    id,
    contactId,
    territoryId,
    status: "subscribed" as const,
    source: "test",
    preferences: { newsletter: true },
    subscribedAt: "2026-08-11T00:00:00.000Z",
    unsubscribedAt: null
  };
}

function hqContext() {
  return { userId: ids.users.hq, organisationId: ids.organisations.hq };
}

function localContext() {
  return { userId: ids.users.local, organisationId: ids.organisations.franchise, territoryId: ids.territories.own };
}

function grant(roleId: string, module: string, action: string, scope: string) {
  return {
    roleId,
    permission: { id: `${module}:${action}`, module, action },
    scope
  };
}

function audit() {
  return {
    events: [] as Array<{ action: string }>,
    async record(event: { action: string }) {
      this.events.push(event);
    }
  };
}
