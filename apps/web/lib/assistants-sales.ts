import type { Advertiser360, CatalogueView } from "@raring2go/advertising";
import { advertiserBriefTask, outreachDraftTask } from "@raring2go/assistants";
import type { AdvertiserBriefOutput, CataloguePackage, OutreachDraftInput, OutreachDraftOutput, SalesFacts } from "@raring2go/assistants";
import { readAdvertiser360, readCatalogue } from "./advertising-runtime";
import { assistantsConfigured, latestAssistantOutput, runAssistant } from "./assistants-runtime";
import type { AssistantActor } from "./assistants-runtime";
import { getDirectory } from "./directory";

const isoDate = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString().slice(0, 10) : null);

/**
 * Turn an advertiser's CRM record into the plain facts the sales assistant is allowed to know. The record
 * was loaded through the advertising service, so the actor's territory and permissions already limited it:
 * the assistant never sees anything the person could not see themselves.
 */
export function buildSalesFacts(view: Advertiser360, territoryName: string | null): SalesFacts {
  const activity = view.activity
    .map((event) => (event as { createdAt?: Date | string }).createdAt)
    .filter(Boolean)
    .map((value) => new Date(value as Date | string).getTime());

  return {
    advertiserName: view.organisation.name,
    relationshipState: String(view.advertiser.relationshipState),
    territoryName: view.territory?.name ?? territoryName,
    firstBookedOn: view.advertiser.firstBookedOn ?? null,
    lastBookedOn: view.advertiser.lastBookedOn ?? null,
    annualValueMinor: view.advertiser.annualAdvertiserValueMinor,
    averageSaleValueMinor: view.advertiser.averageSaleValueMinor,
    contacts: view.contacts.length,
    lastActivityOn: activity.length ? isoDate(new Date(Math.max(...activity))) : null,
    openOpportunities: view.opportunities
      .filter((entry) => entry.state === "open")
      .map((entry) => ({
        id: entry.opportunity.id,
        title: entry.opportunity.title,
        stage: entry.stage.name,
        valueMinor: entry.opportunity.estimatedValueMinor,
        probability: entry.opportunity.probability,
        nextAction: entry.opportunity.nextAction ?? null,
        nextActionOn: entry.opportunity.nextActionDate ?? null,
        expectedCloseOn: entry.opportunity.expectedCloseDate ?? null
      })),
    proposals: view.proposals.map((proposal) => ({ id: proposal.id, title: proposal.title, status: String(proposal.status), totalMinor: proposal.totalValueMinor, validUntil: proposal.validUntil ?? null, sentOn: proposal.sentOn ?? null })),
    bookings: view.bookings.map((booking) => ({ id: booking.id, status: String(booking.status), totalMinor: booking.totalValueMinor, bookedOn: booking.bookedOn })),
    finance: { outstandingMinor: view.financeSummary.outstandingMinor, overdueMinor: view.financeSummary.overdueMinor, unallocatedMinor: view.financeSummary.unallocatedPaymentsMinor },
    openRenewalPrompts: view.renewalPrompts.filter((prompt) => prompt.status === "open").map((prompt) => ({ id: prompt.id, dueOn: prompt.dueOn ?? null })),
    fulfilments: {
      upcoming: view.campaignFulfilments.filter((fulfilment) => fulfilment.status === "scheduled" || fulfilment.status === "in_progress").length,
      fulfilled: view.campaignFulfilments.filter((fulfilment) => fulfilment.status === "fulfilled").length
    },
    // Not recorded against the advertiser today; package ideas then rest on typical spend alone.
    packagesBought: []
  };
}

/** Packages with a price: the sum of their lines at each product's standard price in an active price book. */
export function cataloguePackages(catalogue: CatalogueView): CataloguePackage[] {
  const standard = new Map<string, number>();
  for (const item of catalogue.priceBookItems) if (!standard.has(item.productId)) standard.set(item.productId, item.standardPriceMinor);

  return catalogue.packages.map((bundle) => {
    let total = 0;
    let known = true;
    for (const line of bundle.lines) {
      const price = standard.get(String(line.productId));
      if (price === undefined) known = false;
      else total += price * Number(line.quantity ?? 1);
    }
    return { key: bundle.key, name: bundle.name, priceMinor: known && bundle.lines.length ? total : null };
  });
}

export type SalesPanel = {
  facts: SalesFacts;
  brief?: { runId: string; createdAt: Date; output: AdvertiserBriefOutput };
  draft?: { runId: string; createdAt: Date; approvalState: string; output: OutreachDraftOutput; purpose?: string };
  aiConfigured: boolean;
  catalogue: CataloguePackage[];
  today: string;
};

/** Everything the sales panel shows. The analysis is computed here from the record: no model involved. */
export async function readSalesPanel(actor: AssistantActor & { organisationId?: string | null }, advertiserId: string): Promise<SalesPanel> {
  const view = await readAdvertiser360(actor, advertiserId);
  const catalogue = cataloguePackages(await readCatalogue(actor).catch(() => ({ products: [], packages: [], priceBooks: [], priceBookItems: [], inventorySlots: [] }) as CatalogueView));
  const territoryName = view.advertiser.owningTerritoryId ? ((await getDirectory().territoryName(view.advertiser.owningTerritoryId)) ?? null) : null;
  const subject = { type: "advertiser", id: advertiserId };
  const [brief, draft] = await Promise.all([
    latestAssistantOutput<AdvertiserBriefOutput>(actor, advertiserBriefTask, subject).catch(() => undefined),
    latestAssistantOutput<OutreachDraftOutput>(actor, outreachDraftTask, subject).catch(() => undefined)
  ]);

  return {
    facts: buildSalesFacts(view, territoryName),
    brief: brief ? { runId: brief.run.id, createdAt: brief.run.createdAt, output: brief.output } : undefined,
    draft: draft ? { runId: draft.run.id, createdAt: draft.run.createdAt, approvalState: draft.run.approvalState, output: draft.output } : undefined,
    aiConfigured: assistantsConfigured(),
    catalogue,
    today: new Date().toISOString().slice(0, 10)
  };
}

export async function generateAdvertiserBrief(actor: AssistantActor, advertiserId: string) {
  const panel = await readSalesPanel(actor, advertiserId);
  return runAssistant(actor, advertiserBriefTask, { facts: panel.facts, catalogue: panel.catalogue, today: panel.today }, { type: "advertiser", id: advertiserId });
}

export async function generateOutreachDraft(actor: AssistantActor, advertiserId: string, input: { purpose: OutreachDraftInput["purpose"]; senderName: string; talkingPoints?: string | null }) {
  const panel = await readSalesPanel(actor, advertiserId);
  return runAssistant(actor, outreachDraftTask, { facts: panel.facts, purpose: input.purpose, senderName: input.senderName, talkingPoints: input.talkingPoints ?? null }, { type: "advertiser", id: advertiserId });
}
