import { randomUUID } from "node:crypto";
import { advertiserActivityEvents, advertiserContacts, advertisers, auditEvents, createDb, fixtureIds, opportunities, organisations } from "@raring2go/db";
import { loadAdvertisingData } from "@raring2go/advertising";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  DuplicateAdvertiserError,
  addContactRecord,
  createAdvertiserRecord,
  createOpportunityRecord,
  logActivityRecord,
  moveOpportunityStage,
  refreshMetricsRecord,
  updateAdvertiserRecord,
  updateOpportunityRecord
} from "./advertising-mutations";

/** Real database: staff CRM writes persist, are audited, and respect territory scope. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("advertiser CRM mutations (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
  const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const createdAdvertisers: string[] = [];
  const createdOrganisations: string[] = [];

  afterAll(async () => {
    if (createdAdvertisers.length > 0) {
      await db.delete(advertiserActivityEvents).where(inArray(advertiserActivityEvents.advertiserId, createdAdvertisers));
      await db.delete(opportunities).where(inArray(opportunities.advertiserId, createdAdvertisers));
      await db.delete(advertiserContacts).where(inArray(advertiserContacts.advertiserId, createdAdvertisers));
      await db.delete(advertisers).where(inArray(advertisers.id, createdAdvertisers));
    }
    if (createdOrganisations.length > 0) await db.delete(organisations).where(inArray(organisations.id, createdOrganisations));
    await sql.end();
  });

  async function create(context: typeof hq | typeof sutton, name: string, territoryId: string = fixtureIds.territories.suttonColdfield) {
    const advertiser = await createAdvertiserRecord(context, { newOrganisationName: name, owningTerritoryId: territoryId });
    createdAdvertisers.push(advertiser.id);
    createdOrganisations.push(advertiser.advertiserOrganisationId);
    return advertiser;
  }

  it("creates an advertiser with its organisation, rejects a duplicate name and audits the creation", async () => {
    const name = `CRM Test Cafe ${tag}`;
    const advertiser = await create(sutton, name);
    expect(advertiser).toMatchObject({ status: "prospect", owningTerritoryId: fixtureIds.territories.suttonColdfield, accountOwnerUserId: sutton.userId });

    const [row] = await db.select().from(advertisers).where(eq(advertisers.id, advertiser.id));
    expect(row?.relationshipState).toBe("new");
    const [organisation] = await db.select().from(organisations).where(eq(organisations.id, advertiser.advertiserOrganisationId));
    expect(organisation).toMatchObject({ kind: "advertiser", name });

    await expect(createAdvertiserRecord(sutton, { newOrganisationName: `  ${name.toUpperCase()}  `, owningTerritoryId: fixtureIds.territories.suttonColdfield })).rejects.toBeInstanceOf(DuplicateAdvertiserError);

    const audit = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, advertiser.id), eq(auditEvents.action, "advertiser.create")));
    expect(audit).toHaveLength(1);
  });

  it("will not create an advertiser in a territory the user does not cover, and leaves no organisation behind", async () => {
    const name = `CRM Out Of Scope ${tag}`;
    await expect(createAdvertiserRecord(sutton, { newOrganisationName: name, owningTerritoryId: fixtureIds.territories.solihull })).rejects.toThrow();
    const leftover = await db.select().from(organisations).where(eq(organisations.name, name));
    expect(leftover).toHaveLength(0);
  });

  it("records contacts, activity and edits against the advertiser", async () => {
    const advertiser = await create(sutton, `CRM Contacts ${tag}`);
    await addContactRecord(sutton, advertiser.id, { label: "Owner", name: "Pat Example", email: "pat@example.test", role: "decision_maker", isPrimary: true });
    await logActivityRecord(sutton, advertiser.id, { activityType: "call", title: "Intro call", body: "Interested in the autumn issue." });
    await updateAdvertiserRecord(sutton, advertiser.id, { status: "active", notes: "Prefers email." });

    const [contact] = await db.select().from(advertiserContacts).where(eq(advertiserContacts.advertiserId, advertiser.id));
    expect(contact).toMatchObject({ name: "Pat Example", isPrimary: true });
    const activity = await db.select().from(advertiserActivityEvents).where(eq(advertiserActivityEvents.advertiserId, advertiser.id));
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ activityType: "call", actorUserId: sutton.userId, territoryId: fixtureIds.territories.suttonColdfield });
    const [row] = await db.select().from(advertisers).where(eq(advertisers.id, advertiser.id));
    expect(row).toMatchObject({ status: "active", commercialMetadata: { internalNotes: "Prefers email." } });
  });

  it("walks an opportunity through the pipeline; a lost deal needs a reason", async () => {
    const advertiser = await create(sutton, `CRM Pipeline ${tag}`);
    const stages = (await loadAdvertisingData(db)).pipelineStages;
    const lead = stages.find((stage) => !stage.isClosed)!;
    const won = stages.find((stage) => stage.outcome === "won")!;
    const lost = stages.find((stage) => stage.outcome === "lost")!;

    const opportunity = await createOpportunityRecord(sutton, { advertiserId: advertiser.id, stageId: lead.id, title: "Autumn half page", estimatedValueMinor: 45000, nextAction: "Send proposal", nextActionDate: "2099-01-01" });
    expect(opportunity.territoryId).toBe(fixtureIds.territories.suttonColdfield);

    await updateOpportunityRecord(sutton, opportunity.id, { nextAction: "Chase", estimatedValueMinor: 50000 });
    await expect(moveOpportunityStage(sutton, opportunity.id, { stageId: lost.id })).rejects.toThrow(/reason/);

    await moveOpportunityStage(sutton, opportunity.id, { stageId: won.id });
    const [row] = await db.select().from(opportunities).where(eq(opportunities.id, opportunity.id));
    expect(row).toMatchObject({ stageId: won.id, nextAction: "Chase", estimatedValueMinor: 50000, probability: won.probabilityDefault });
    expect(row?.closedAt).toBeTruthy();

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityId, advertiser.id));
    expect(audit.map((event) => event.action)).toEqual(expect.arrayContaining(["advertiser.opportunity.create", "advertiser.opportunity.update", "advertiser.opportunity.stage.change"]));
  });

  it("keeps territories apart: a Sutton franchisee cannot read-modify another territory's advertiser", async () => {
    const solihullAdvertiser = await create(hq, `CRM Solihull ${tag}`, fixtureIds.territories.solihull);
    await expect(updateAdvertiserRecord(sutton, solihullAdvertiser.id, { status: "paused" })).rejects.toThrow();
    await expect(addContactRecord(sutton, solihullAdvertiser.id, { label: "x", name: "x", email: "x@example.test", role: "x", isPrimary: false })).rejects.toThrow();
    await expect(logActivityRecord(sutton, solihullAdvertiser.id, { activityType: "note", title: "x" })).rejects.toThrow();
    await expect(createOpportunityRecord(sutton, { advertiserId: solihullAdvertiser.id, stageId: (await loadAdvertisingData(db)).pipelineStages[0]!.id, title: "x", estimatedValueMinor: 1 })).rejects.toThrow();
    await expect(refreshMetricsRecord(sutton, solihullAdvertiser.id)).rejects.toThrow();

    const [row] = await db.select().from(advertisers).where(eq(advertisers.id, solihullAdvertiser.id));
    expect(row?.status).toBe("prospect");
  });

  it("refreshing metrics from an advertiser with no bookings leaves the new-advertiser defaults alone", async () => {
    const advertiser = await create(sutton, `CRM Metrics ${tag}`);
    const result = await refreshMetricsRecord(sutton, advertiser.id);
    expect(result.changed).toEqual([]);
  });
});
