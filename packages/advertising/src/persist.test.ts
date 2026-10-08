import { describe, expect, it, vi } from "vitest";
import { persistAdvertisingChanges, persistedCollections, planAdvertisingChanges, snapshotAdvertisingData, toDbRow } from "./persist";
import type { AdvertisingData } from "./types";
import { advertiserProposalAcceptances, artworkRequirements } from "@raring2go/db";

function blank(): AdvertisingData {
  const keys = [...persistedCollections.map(([key]) => key), "organisations", "territories"];
  return Object.fromEntries(keys.map((key) => [key, []])) as unknown as AdvertisingData;
}

const requirement = (overrides: Record<string, unknown> = {}) => ({
  id: "req-1", productionRequestId: "pr-1", bookingItemId: "bi-1", advertiserId: "adv-1", territoryId: "t-1", sourceType: "advertiser_supplied",
  status: "requested", specification: {}, dimensions: {}, contentFields: {}, deadline: "2026-04-01", approvedVersionId: null, ...overrides
});

describe("toDbRow", () => {
  it("converts ISO strings to Dates for date columns only, drops unknown and undefined keys, and never writes managed columns", () => {
    const row = toDbRow(artworkRequirements, { ...requirement(), notAColumn: "x", status: undefined, createdAt: "2020-01-01", updatedAt: "2020-01-01" } as never);
    expect(row.deadline).toEqual(new Date("2026-04-01"));
    expect(row).not.toHaveProperty("notAColumn");
    expect(row).not.toHaveProperty("status");
    expect(row).not.toHaveProperty("createdAt");
    expect(row).not.toHaveProperty("updatedAt");
    expect(row.specification).toEqual({});
  });
});

describe("planAdvertisingChanges", () => {
  it("plans nothing when nothing changed", () => {
    const before = blank();
    before.artworkRequirements.push(requirement() as never);
    expect(planAdvertisingChanges(before, snapshotAdvertisingData(before))).toEqual([]);
  });

  it("inserts new rows and updates only the columns that changed", () => {
    const before = blank();
    before.artworkRequirements.push(requirement() as never);
    const after = snapshotAdvertisingData(before);
    after.artworkRequirements[0]!.status = "submitted";
    after.acceptances.push({ id: "acc-1", proposalId: "p-1", advertiserId: "adv-1", territoryId: "t-1", termsId: "terms-1", method: "simple", status: "accepted", acceptedAt: "2026-03-01", requestMetadata: {}, commercialSnapshot: {}, providerMetadata: {}, idempotencyKey: "k" } as never);

    const plan = planAdvertisingChanges(before, after);
    expect(plan.map((change) => change.collection)).toEqual(["acceptances", "artworkRequirements"]);
    expect(plan[0]!.inserts).toHaveLength(1);
    expect(plan[0]!.inserts[0]).toMatchObject({ id: "acc-1", acceptedAt: new Date("2026-03-01") });
    expect(plan[1]!.updates).toEqual([{ id: "req-1", changes: { status: "submitted" } }]);
  });

  it("inserts parents before children", () => {
    const order = persistedCollections.map(([key]) => key);
    expect(order.indexOf("advertisers")).toBeLessThan(order.indexOf("proposals"));
    expect(order.indexOf("proposals")).toBeLessThan(order.indexOf("bookings"));
    expect(order.indexOf("bookings")).toBeLessThan(order.indexOf("bookingItems"));
    expect(order.indexOf("productionRequests")).toBeLessThan(order.indexOf("artworkRequirements"));
    expect(order.indexOf("artworkRequirements")).toBeLessThan(order.indexOf("artworkVersions"));
    expect(order.indexOf("invoices")).toBeLessThan(order.indexOf("invoiceLines"));
    expect(order.indexOf("payments")).toBeLessThan(order.indexOf("paymentAllocations"));
  });

  it("refuses to silently diverge when a domain function removes a row", () => {
    const before = blank();
    before.artworkRequirements.push(requirement() as never);
    const after = snapshotAdvertisingData(before);
    after.artworkRequirements.length = 0;
    expect(() => planAdvertisingChanges(before, after)).toThrow(/removed by a domain function/);
  });

  it("treats Date and equal-ISO values as unchanged", () => {
    const before = blank();
    before.acceptances.push({ id: "acc-1", proposalId: "p", advertiserId: "a", territoryId: "t", termsId: "x", method: "simple", status: "accepted", acceptedAt: "2026-03-01", requestMetadata: {}, commercialSnapshot: {}, providerMetadata: {}, idempotencyKey: "k" } as never);
    const after = snapshotAdvertisingData(before);
    expect(planAdvertisingChanges(before, after)).toEqual([]);
  });
});

describe("persistAdvertisingChanges", () => {
  it("writes inserts then updates, stamps updatedAt on updates, and fails if an updated row vanished", async () => {
    const calls: Array<[string, unknown]> = [];
    const db = {
      insert: (table: unknown) => ({ values: async (values: unknown) => { calls.push(["insert", { table: table === advertiserProposalAcceptances ? "acceptances" : "other", values }]); } }),
      update: () => ({ set: (values: unknown) => ({ where: () => ({ returning: async () => { calls.push(["update", values]); return [{}]; } }) }) })
    };
    const before = blank();
    before.artworkRequirements.push(requirement() as never);
    const after = snapshotAdvertisingData(before);
    after.artworkRequirements[0]!.status = "approved";
    after.acceptances.push({ id: "acc-1", proposalId: "p", advertiserId: "a", territoryId: "t", termsId: "x", method: "simple", status: "accepted", requestMetadata: {}, commercialSnapshot: {}, providerMetadata: {}, idempotencyKey: "k" } as never);

    const now = new Date("2026-03-01T00:00:00Z");
    expect(await persistAdvertisingChanges(db as never, before, after, now)).toEqual({ inserted: 1, updated: 1 });
    expect(calls.map(([kind]) => kind)).toEqual(["insert", "update"]);
    expect(calls[1]![1]).toEqual({ status: "approved", updatedAt: now });

    const vanished = { ...db, update: () => ({ set: () => ({ where: () => ({ returning: vi.fn(async () => []) }) }) }) };
    await expect(persistAdvertisingChanges(vanished as never, before, after)).rejects.toThrow(/no longer exists/);
  });
});
