import { describe, expect, it } from "vitest";
import { evaluateSegmentRules, normalizeSegmentDefinition, validateSegmentDefinition, type SegmentRuleGroup } from "./segment-rules";
import type { AudienceContactView } from "./types";

function view(overrides: Partial<AudienceContactView> = {}): AudienceContactView {
  return {
    contact: {
      id: "contact_1",
      email: "parent@example.test",
      emailNormalised: "parent@example.test",
      emailStatus: "subscribed",
      tags: [],
      metadata: {}
    },
    subscriptions: [],
    consentEvents: [],
    suppressions: [],
    activity: [],
    ...overrides
  };
}

describe("normalizeSegmentDefinition (legacy compat)", () => {
  it("upgrades {territoryId} into a territory-equals condition", () => {
    const root = normalizeSegmentDefinition({ territoryId: "territory_sutton" });
    expect(root).toEqual({
      kind: "group",
      match: "all",
      children: [{ kind: "condition", field: "territoryId", operator: "equals", value: "territory_sutton" }]
    });
  });

  it("falls back to a subscribed-anywhere condition when there's no territoryId in definition or fallback", () => {
    const root = normalizeSegmentDefinition({});
    expect(root).toEqual({
      kind: "group",
      match: "all",
      children: [{ kind: "condition", field: "subscriptionStatus", operator: "equals", value: "subscribed" }]
    });
  });

  it("uses the segment's own territoryId column as a fallback when definition has none", () => {
    const root = normalizeSegmentDefinition({ interests: ["days-out"] }, "territory_sutton");
    expect(root).toEqual({
      kind: "group",
      match: "all",
      children: [{ kind: "condition", field: "territoryId", operator: "equals", value: "territory_sutton" }]
    });
  });

  it("passes an already-structured definition through unchanged", () => {
    const root: SegmentRuleGroup = { kind: "group", match: "any", children: [{ kind: "condition", field: "tag", operator: "equals", value: "vip" }] };
    expect(normalizeSegmentDefinition({ version: 1, root })).toEqual(root);
  });

  it("reproduces the legacy matcher's exact behaviour for a territory-scoped segment", () => {
    const legacyRoot = normalizeSegmentDefinition({ territoryId: "territory_sutton" });
    const subscribedThere = view({ subscriptions: [{ id: "s1", contactId: "contact_1", territoryId: "territory_sutton", status: "subscribed", source: "signup", preferences: {} }] });
    const subscribedElsewhere = view({ subscriptions: [{ id: "s2", contactId: "contact_1", territoryId: "territory_other", status: "subscribed", source: "signup", preferences: {} }] });

    expect(evaluateSegmentRules(subscribedThere, legacyRoot)).toBe(true);
    expect(evaluateSegmentRules(subscribedElsewhere, legacyRoot)).toBe(false);
  });
});

describe("evaluateSegmentRules", () => {
  it("matches a flat AND group only when every condition matches", () => {
    const root: SegmentRuleGroup = {
      kind: "group",
      match: "all",
      children: [
        { kind: "condition", field: "tag", operator: "equals", value: "vip" },
        { kind: "condition", field: "subscriptionStatus", operator: "equals", value: "subscribed" }
      ]
    };
    const matches = view({
      contact: { ...view().contact, tags: ["vip"] },
      subscriptions: [{ id: "s1", contactId: "contact_1", territoryId: "t1", status: "subscribed", source: "signup", preferences: {} }]
    });
    const missingTag = view({
      subscriptions: [{ id: "s1", contactId: "contact_1", territoryId: "t1", status: "subscribed", source: "signup", preferences: {} }]
    });

    expect(evaluateSegmentRules(matches, root)).toBe(true);
    expect(evaluateSegmentRules(missingTag, root)).toBe(false);
  });

  it("matches an OR group when at least one condition matches", () => {
    const root: SegmentRuleGroup = {
      kind: "group",
      match: "any",
      children: [
        { kind: "condition", field: "tag", operator: "equals", value: "vip" },
        { kind: "condition", field: "tag", operator: "equals", value: "founder" }
      ]
    };
    const founder = view({ contact: { ...view().contact, tags: ["founder"] } });
    const neither = view({ contact: { ...view().contact, tags: ["regular"] } });

    expect(evaluateSegmentRules(founder, root)).toBe(true);
    expect(evaluateSegmentRules(neither, root)).toBe(false);
  });

  it("evaluates nested groups: territory AND (tag OR recent activity)", () => {
    const root: SegmentRuleGroup = {
      kind: "group",
      match: "all",
      children: [
        { kind: "condition", field: "territoryId", operator: "equals", value: "t1" },
        {
          kind: "group",
          match: "any",
          children: [
            { kind: "condition", field: "tag", operator: "equals", value: "vip" },
            { kind: "condition", field: "activityWithinDays", operator: "equals", value: 30 }
          ]
        }
      ]
    };
    const subscribedInT1 = { id: "s1", contactId: "contact_1", territoryId: "t1", status: "subscribed" as const, source: "signup", preferences: {} };

    const vipInT1 = view({ subscriptions: [subscribedInT1], contact: { ...view().contact, tags: ["vip"] } });
    const recentActivityInT1 = view({
      subscriptions: [subscribedInT1],
      activity: [{ id: "a1", contactId: "contact_1", activityType: "click", title: "Clicked", metadata: {}, occurredAt: new Date().toISOString() }]
    });
    const neitherInT1 = view({ subscriptions: [subscribedInT1] });
    const vipButWrongTerritory = view({
      subscriptions: [{ ...subscribedInT1, territoryId: "t2" }],
      contact: { ...view().contact, tags: ["vip"] }
    });

    expect(evaluateSegmentRules(vipInT1, root)).toBe(true);
    expect(evaluateSegmentRules(recentActivityInT1, root)).toBe(true);
    expect(evaluateSegmentRules(neitherInT1, root)).toBe(false);
    expect(evaluateSegmentRules(vipButWrongTerritory, root)).toBe(false);
  });

  it("evaluates activityWithinDays relative to a fixed 'now' and respects not_equals", () => {
    const root: SegmentRuleGroup = { kind: "group", match: "all", children: [{ kind: "condition", field: "activityWithinDays", operator: "equals", value: 7 }] };
    const now = new Date("2026-08-20T00:00:00.000Z");
    const recentlyActive = view({ activity: [{ id: "a1", contactId: "contact_1", activityType: "open", title: "Opened", metadata: {}, occurredAt: "2026-08-18T00:00:00.000Z" }] });
    const staleActivity = view({ activity: [{ id: "a1", contactId: "contact_1", activityType: "open", title: "Opened", metadata: {}, occurredAt: "2026-07-01T00:00:00.000Z" }] });

    expect(evaluateSegmentRules(recentlyActive, root, now)).toBe(true);
    expect(evaluateSegmentRules(staleActivity, root, now)).toBe(false);

    const inverted: SegmentRuleGroup = { kind: "group", match: "all", children: [{ kind: "condition", field: "activityWithinDays", operator: "not_equals", value: 7 }] };
    expect(evaluateSegmentRules(staleActivity, inverted, now)).toBe(true);
  });

  it("evaluates consentType against the latest event for that type", () => {
    const root: SegmentRuleGroup = { kind: "group", match: "all", children: [{ kind: "condition", field: "consentType", operator: "equals", value: "newsletter" }] };
    const stillGranted = view({
      consentEvents: [
        { id: "c1", contactId: "contact_1", consentType: "newsletter", action: "granted", source: "signup", occurredAt: "2026-01-01T00:00:00.000Z", evidence: {} }
      ]
    });
    const laterWithdrawn = view({
      consentEvents: [
        { id: "c1", contactId: "contact_1", consentType: "newsletter", action: "granted", source: "signup", occurredAt: "2026-01-01T00:00:00.000Z", evidence: {} },
        { id: "c2", contactId: "contact_1", consentType: "newsletter", action: "withdrawn", source: "preference_centre", occurredAt: "2026-02-01T00:00:00.000Z", evidence: {} }
      ]
    });

    expect(evaluateSegmentRules(stillGranted, root)).toBe(true);
    expect(evaluateSegmentRules(laterWithdrawn, root)).toBe(false);
  });

  it("evaluates interest against the contact's preference profile", () => {
    const root: SegmentRuleGroup = { kind: "group", match: "all", children: [{ kind: "condition", field: "interest", operator: "in", value: ["days-out", "crafts"] }] };
    const interested = view({
      profile: {
        id: "profile_1",
        contactId: "contact_1",
        followedTerritoryIds: [],
        childAgeBands: [],
        interests: ["days-out"],
        eventCategories: [],
        offerPreferences: [],
        competitionPreferences: [],
        newsletterFrequency: "weekly",
        communicationPreferences: {},
        personalisationEnabled: true,
        privacyMetadata: {}
      }
    });
    const notInterested = view();

    expect(evaluateSegmentRules(interested, root)).toBe(true);
    expect(evaluateSegmentRules(notInterested, root)).toBe(false);
  });

  it("treats an empty AND group as vacuously true and an empty OR group as vacuously false", () => {
    expect(evaluateSegmentRules(view(), { kind: "group", match: "all", children: [] })).toBe(true);
    expect(evaluateSegmentRules(view(), { kind: "group", match: "any", children: [] })).toBe(false);
  });
});

describe("validateSegmentDefinition (untrusted-JSON trust boundary)", () => {
  it("accepts a well-formed nested rule tree", () => {
    const root = {
      kind: "group",
      match: "all",
      children: [
        { kind: "condition", field: "territoryId", operator: "equals", value: "t1" },
        { kind: "group", match: "any", children: [{ kind: "condition", field: "tag", operator: "equals", value: "vip" }] }
      ]
    };
    expect(validateSegmentDefinition(root)).toEqual(root);
  });

  it("rejects an unknown field", () => {
    expect(() =>
      validateSegmentDefinition({ kind: "group", match: "all", children: [{ kind: "condition", field: "ssn", operator: "equals", value: "x" }] })
    ).toThrow(/malformed/);
  });

  it("rejects an unknown operator", () => {
    expect(() =>
      validateSegmentDefinition({ kind: "group", match: "all", children: [{ kind: "condition", field: "tag", operator: "greater_than", value: "x" }] })
    ).toThrow(/malformed/);
  });

  it("rejects a malformed group shape", () => {
    expect(() => validateSegmentDefinition({ kind: "group", match: "xor", children: [] })).toThrow(/malformed/);
    expect(() => validateSegmentDefinition("not an object")).toThrow(/malformed/);
  });
});
