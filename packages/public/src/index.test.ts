import { describe, expect, it } from "vitest";
import { fixtureIds, foundationSeed } from "@raring2go/db";
import { defaultPublicTerritorySlug, getPublicHomepage, publicHomepageTemplate, territoryFromSlug } from ".";

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

function importTable(name: string) {
  return (awaitedDbTables as Record<string, unknown>)[name];
}

import * as awaitedDbTables from "@raring2go/db";
