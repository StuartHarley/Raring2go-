import { describe, expect, it } from "vitest";
import { fixtureIds, foundationSeed } from "@raring2go/db";
import {
  defaultPublicTerritorySlug,
  getPublicDiscovery,
  getPublicHomepage,
  getPublicMagazine,
  getPublicParentHub,
  getPublicCommercialDiscovery,
  publicHomepageTemplate,
  territoryFromSlug
} from ".";

const db = {
  select() {
    return {
      async from(table: unknown): Promise<Array<Record<string, unknown>>> {
        return rowsFor(table);
      }
    };
  }
};

describe("@raring2go/public homepage", () => {
  it("resolves territory slugs without exposing database IDs in URLs", () => {
    expect(territoryFromSlug(defaultPublicTerritorySlug)).toMatchObject({
      id: fixtureIds.territories.suttonColdfield,
      slug: "sutton-coldfield"
    });
  });

  it("defines centrally controlled homepage slots", () => {
    expect(publicHomepageTemplate.slots.map((slot) => slot.kind)).toEqual([
      "hero",
      "stories",
      "whats_on",
      "things_to_do",
      "magazine",
      "offers",
      "competitions",
      "advertisers",
      "newsletter",
      "community"
    ]);
  });

  it("does not expose draft content on the public homepage", async () => {
    const homepage = await getPublicHomepage(db, defaultPublicTerritorySlug);

    expect(homepage?.stories).toEqual([]);
    expect(homepage?.emptyStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slot: "stories"
        })
      ])
    );
  });
});

describe("@raring2go/public parent hub", () => {
  it("returns a sign-in prompt without a parent contact", async () => {
    const hub = await getPublicParentHub(db, defaultPublicTerritorySlug);

    expect(hub).toMatchObject({
      authenticated: false,
      savedContent: []
    });
    expect(hub?.emptyState).toContain("Sign in");
  });

  it("uses native audience preferences and saved content for parent accounts", async () => {
    const hub = await getPublicParentHub(db, defaultPublicTerritorySlug, fixtureIds.audienceContacts.parentOne);

    expect(hub?.authenticated).toBe(true);
    expect(hub?.followedTerritories.map((territory) => territory.slug)).toEqual(["sutton-coldfield", "solihull"]);
    expect(hub?.savedContent.map((item) => item.title)).toEqual(["Half term ideas near you"]);
    expect(hub?.preferences).toMatchObject({
      interests: ["days-out", "school-holidays"],
      personalisationEnabled: true
    });
  });
});

describe("@raring2go/public magazine", () => {
  it("does not expose draft or ungenerated editions", async () => {
    const magazine = await getPublicMagazine(db, defaultPublicTerritorySlug);

    expect(magazine?.edition).toBeUndefined();
    expect(magazine?.emptyState).toContain("not public yet");
  });

  it("exposes only published generated digital output", async () => {
    const magazine = await getPublicMagazine(dbWithTables({
      territoryEditions: [
        {
          ...foundationSeed.territoryEditions[0],
          status: "published",
          digitalStatus: "generated",
          pageCount: 1
        }
      ],
      publicationOutputs: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          territoryEditionId: fixtureIds.territoryEditions.suttonAutumn2026,
          outputType: "digital",
          status: "generated",
          version: 2,
          sourcePageSnapshot: [],
          artifact: { storageKey: "public/magazines/sutton-autumn-2026" },
          preflightResultId: null,
          idempotencyKey: "test-public-output",
          corrections: [],
          metadata: {},
          generatedByUserId: fixtureIds.users.superAdmin,
          generatedAt: "2026-08-11"
        }
      ],
      editionPages: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          territoryEditionId: fixtureIds.territoryEditions.suttonAutumn2026,
          pageNumber: 1,
          spreadNumber: 1,
          side: "single",
          status: "published",
          templateVersionId: null,
          assignedContentId: null,
          advertiserInventoryState: "none",
          ownerType: "central",
          deadline: null,
          sourceMarker: "central",
          locked: true,
          readiness: "ready",
          comments: [],
          issues: []
        }
      ]
    }), defaultPublicTerritorySlug);

    expect(magazine?.edition).toMatchObject({
      title: "Autumn 2026 Sutton Coldfield",
      outputVersion: 2
    });
    expect(magazine?.edition?.pages).toHaveLength(1);
  });
});

describe("@raring2go/public commercial discovery", () => {
  it("labels public sponsored content without exposing drafts", async () => {
    const discovery = await getPublicCommercialDiscovery(dbWithContent([
      publicContent({
        id: "66666666-6666-4666-8666-666666666666",
        title: "Soft play discount",
        contentType: "offer",
        status: "published"
      }),
      publicContent({
        id: "77777777-7777-4777-8777-777777777777",
        title: "Draft free trial",
        contentType: "offer",
        status: "draft"
      })
    ]), defaultPublicTerritorySlug, "offers");

    expect(discovery?.items).toHaveLength(1);
    expect(discovery?.labels).toContain("Sponsored");
  });

  it("shows active advertiser placements for the selected territory only", async () => {
    const discovery = await getPublicCommercialDiscovery(dbWithAdvertisers([
      publicAdvertiser({
        id: "88888888-8888-4888-8888-888888888888",
        owningTerritoryId: fixtureIds.territories.suttonColdfield,
        status: "active"
      }),
      publicAdvertiser({
        id: "99999999-9999-4999-8999-999999999999",
        owningTerritoryId: fixtureIds.territories.solihull,
        status: "active"
      }),
      publicAdvertiser({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        owningTerritoryId: fixtureIds.territories.suttonColdfield,
        status: "paused"
      })
    ]), defaultPublicTerritorySlug, "businesses");

    expect(discovery?.placements.map((placement) => placement.id)).toEqual(["88888888-8888-4888-8888-888888888888"]);
  });
});

describe("@raring2go/public discovery", () => {
  it("filters public events by query and category", async () => {
    const discovery = await getPublicDiscovery(dbWithContent([
      publicContent({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Family theatre morning",
        contentType: "event",
        categories: ["theatre"],
        tags: ["indoors"],
        status: "published"
      }),
      publicContent({
        id: "22222222-2222-4222-8222-222222222222",
        title: "Swimming club taster",
        contentType: "event",
        categories: ["sport"],
        tags: ["active"],
        status: "published"
      })
    ]), defaultPublicTerritorySlug, "whats_on", { query: "theatre", category: "theatre" });

    expect(discovery?.items).toHaveLength(1);
    expect(discovery?.items[0]?.title).toBe("Family theatre morning");
  });

  it("does not expose draft discovery records", async () => {
    const discovery = await getPublicDiscovery(dbWithContent([
      publicContent({
        id: "33333333-3333-4333-8333-333333333333",
        title: "Draft woodland walk",
        contentType: "event",
        status: "draft"
      })
    ]), defaultPublicTerritorySlug, "whats_on");

    expect(discovery?.items).toEqual([]);
    expect(discovery?.emptyState).toContain("Nothing public matches");
  });

  it("keeps activities separate from dated events", async () => {
    const discovery = await getPublicDiscovery(dbWithContent([
      publicContent({
        id: "44444444-4444-4444-8444-444444444444",
        title: "Rainy day crafts",
        contentType: "guide",
        categories: ["craft"],
        status: "approved"
      }),
      publicContent({
        id: "55555555-5555-4555-8555-555555555555",
        title: "Park fun day",
        contentType: "event",
        status: "published"
      })
    ]), defaultPublicTerritorySlug, "activities");

    expect(discovery?.items.map((item) => item.title)).toEqual(["Rainy day crafts"]);
  });
});

function rowsFor(table: unknown): Array<Record<string, unknown>> {
  const seed = foundationSeed as unknown as Record<string, Array<Record<string, unknown>>>;
  const mapping = new Map<unknown, Array<Record<string, unknown>>>([
    [importTable("seasons"), seed.seasons ?? []],
    [importTable("masterEditions"), seed.masterEditions ?? []],
    [importTable("territoryEditions"), seed.territoryEditions ?? []],
    [importTable("magazineTemplates"), seed.magazineTemplates ?? []],
    [importTable("magazineTemplateVersions"), seed.magazineTemplateVersions ?? []],
    [importTable("editionContentItems"), seed.editionContentItems ?? []],
    [importTable("territoryEditionContent"), seed.territoryEditionContent ?? []],
    [importTable("editionPages"), seed.editionPages ?? []],
    [importTable("editionPageRevisions"), seed.editionPageRevisions ?? []],
    [importTable("preflightResults"), seed.preflightResults ?? []],
    [importTable("publicationOutputs"), seed.publicationOutputs ?? []],
    [importTable("contentItems"), seed.contentItems ?? []],
    [importTable("contentItemVersions"), seed.contentItemVersions ?? []],
    [importTable("contentChannelVariants"), seed.contentChannelVariants ?? []],
    [importTable("contentChannelVariantVersions"), seed.contentChannelVariantVersions ?? []],
    [importTable("contentLocalisations"), seed.contentLocalisations ?? []],
    [importTable("contentAiTasks"), seed.contentAiTasks ?? []],
    [importTable("contentWebsitePublishingJobs"), seed.contentWebsitePublishingJobs ?? []],
    [importTable("contentDomainEvents"), seed.contentDomainEvents ?? []],
    [importTable("socialAccounts"), seed.socialAccounts ?? []],
    [importTable("socialPublications"), seed.socialPublications ?? []],
    [importTable("socialPublishJobs"), seed.socialPublishJobs ?? []],
    [importTable("socialProviderEvents"), seed.socialProviderEvents ?? []],
    [importTable("territories"), seed.territories ?? []],
    [importTable("audienceContacts"), seed.audienceContacts ?? []],
    [importTable("audienceTerritorySubscriptions"), seed.audienceSubscriptions ?? []],
    [importTable("audienceConsentEvents"), seed.audienceConsentEvents ?? []],
    [importTable("audienceSuppressions"), seed.audienceSuppressions ?? []],
    [importTable("audienceSegments"), seed.audienceSegments ?? []],
    [importTable("audienceSegmentMembers"), seed.audienceSegmentMembers ?? []],
    [importTable("audienceImports"), seed.audienceImports ?? []],
    [importTable("audienceActivityEvents"), seed.audienceActivityEvents ?? []],
    [importTable("audiencePreferenceProfiles"), seed.audiencePreferenceProfiles ?? []],
    [importTable("audienceSavedContent"), seed.audienceSavedContent ?? []],
    [importTable("emailTemplates"), seed.emailTemplates ?? []],
    [importTable("emailCampaigns"), seed.emailCampaigns ?? []],
    [importTable("emailCampaignVersions"), seed.emailCampaignVersions ?? []],
    [importTable("emailRecipientSnapshots"), seed.emailRecipientSnapshots ?? []],
    [importTable("emailDeliveryRecords"), seed.emailDeliveryRecords ?? []],
    [importTable("networkNewsletterMasters"), seed.networkNewsletterMasters ?? []],
    [importTable("territoryNewsletterEditions"), seed.territoryNewsletterEditions ?? []],
    [importTable("newsletterFactoryRuns"), seed.newsletterFactoryRuns ?? []],
    [importTable("marketingJourneys"), seed.marketingJourneys ?? []],
    [importTable("marketingJourneyVersions"), seed.marketingJourneyVersions ?? []],
    [importTable("marketingJourneyAudienceEntries"), seed.marketingJourneyAudienceEntries ?? []],
    [importTable("marketingJourneyExecutions"), seed.marketingJourneyExecutions ?? []],
    [importTable("marketingJourneyStepExecutions"), seed.marketingJourneyStepExecutions ?? []],
    [importTable("advertisers"), seed.advertisers ?? []],
    [importTable("advertiserContacts"), seed.advertiserContacts ?? []],
    [importTable("advertiserActivityEvents"), seed.advertiserActivityEvents ?? []],
    [importTable("advertiserMetricSnapshots"), seed.advertiserMetricSnapshots ?? []],
    [importTable("pipelineStages"), seed.pipelineStages ?? []],
    [importTable("opportunities"), seed.opportunities ?? []],
    [importTable("commercialProducts"), seed.commercialProducts ?? []],
    [importTable("commercialPackages"), seed.commercialPackages ?? []],
    [importTable("priceBooks"), seed.priceBooks ?? []],
    [importTable("priceBookItems"), seed.priceBookItems ?? []],
    [importTable("inventorySlots"), seed.inventorySlots ?? []],
    [importTable("inventoryReservations"), seed.inventoryReservations ?? []],
    [importTable("commercialProposals"), seed.commercialProposals ?? []],
    [importTable("commercialProposalItems"), seed.commercialProposalItems ?? []],
    [importTable("commercialBookings"), seed.commercialBookings ?? []],
    [importTable("commercialBookingItems"), seed.commercialBookingItems ?? []],
    [importTable("commercialProductionRequests"), seed.commercialProductionRequests ?? []],
    [importTable("advertiserTerms"), seed.advertiserTerms ?? []],
    [importTable("advertiserProposalAcceptances"), seed.advertiserProposalAcceptances ?? []],
    [importTable("advertiserDomainEvents"), seed.advertiserDomainEvents ?? []],
    [importTable("advertiserInvoiceSequences"), seed.advertiserInvoiceSequences ?? []],
    [importTable("advertiserInvoices"), seed.advertiserInvoices ?? []],
    [importTable("advertiserInvoiceLines"), seed.advertiserInvoiceLines ?? []],
    [importTable("advertiserCreditNotes"), seed.advertiserCreditNotes ?? []],
    [importTable("advertiserCreditNoteLines"), seed.advertiserCreditNoteLines ?? []],
    [importTable("advertiserPayments"), seed.advertiserPayments ?? []],
    [importTable("advertiserPaymentAllocations"), seed.advertiserPaymentAllocations ?? []],
    [importTable("advertiserProviderSyncReferences"), seed.advertiserProviderSyncReferences ?? []],
    [importTable("artworkRequirements"), seed.artworkRequirements ?? []],
    [importTable("artworkVersions"), seed.artworkVersions ?? []],
    [importTable("campaignFulfilments"), seed.campaignFulfilments ?? []],
    [importTable("proofPacks"), seed.proofPacks ?? []],
    [importTable("renewalPrompts"), seed.renewalPrompts ?? []],
    [importTable("organisations"), seed.organisations ?? []]
  ]);

  return mapping.get(table) ?? [];
}

function dbWithContent(contentItems: Array<Record<string, unknown>>) {
  return {
    select() {
      return {
        async from(table: unknown): Promise<Array<Record<string, unknown>>> {
          if (table === importTable("contentItems")) {
            return contentItems;
          }
          return rowsFor(table);
        }
      };
    }
  };
}

function dbWithAdvertisers(advertisers: Array<Record<string, unknown>>) {
  return {
    select() {
      return {
        async from(table: unknown): Promise<Array<Record<string, unknown>>> {
          if (table === importTable("advertisers")) {
            return advertisers;
          }
          return rowsFor(table);
        }
      };
    }
  };
}

function dbWithTables(overrides: Record<string, Array<Record<string, unknown>>>) {
  return {
    select() {
      return {
        async from(table: unknown): Promise<Array<Record<string, unknown>>> {
          const tableName = Object.entries(awaitedDbTables as Record<string, unknown>)
            .find(([, value]) => value === table)?.[0];
          if (tableName && overrides[tableName]) {
            return overrides[tableName];
          }
          return rowsFor(table);
        }
      };
    }
  };
}

function publicContent(overrides: Partial<Record<string, unknown>>) {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    title: "Public content",
    standfirst: "A public discovery record.",
    contentType: "event",
    ownerLevel: "territory",
    organisationId: fixtureIds.organisations.franchise,
    territoryId: fixtureIds.territories.suttonColdfield,
    status: "published",
    sourceType: "human",
    heroArtifactReference: {},
    categories: [],
    tags: [],
    relevantDates: { startDate: "2026-10-10" },
    provenance: { location: "Sutton Coldfield" },
    ...overrides
  };
}

function publicAdvertiser(overrides: Partial<Record<string, unknown>>) {
  return {
    id: fixtureIds.advertisers.example,
    advertiserOrganisationId: fixtureIds.organisations.advertiser,
    owningTerritoryId: fixtureIds.territories.suttonColdfield,
    accountOwnerUserId: null,
    status: "active",
    relationshipState: "retained",
    source: "test",
    firstBookedOn: null,
    lastBookedOn: null,
    lapsedOn: null,
    averageSaleValueMinor: 0,
    annualAdvertiserValueMinor: 0,
    currency: "GBP",
    tags: ["family"],
    commercialMetadata: {
      publicPlacement: "standard",
      publicSummary: "A tested local business."
    },
    ...overrides
  };
}

function importTable(name: string) {
  return (awaitedDbTables as Record<string, unknown>)[name];
}

import * as awaitedDbTables from "@raring2go/db";
