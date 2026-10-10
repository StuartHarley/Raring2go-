import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { readAdvertiser360, readCatalogue } from "../../../../../lib/advertising-runtime";
import { readSalesPanel } from "../../../../../lib/assistants-sales";
import { getPermissionData } from "../../../../../lib/permission-source";
import { getDirectory } from "../../../../../lib/directory";
import { evaluatePermission } from "@raring2go/permissions";
import { formatCount, formatDate, formatLabel } from "../../../../../lib/format";
import { EmptyState, FactList, LinkButton, Metrics, PageHeader, Panel, RecordCard, RecordList, toneForStatus, type Tone } from "../../../../../lib/page-ui";
import { SalesAssistantPanel } from "./SalesAssistantPanel";
import { CrmBanner } from "../CrmBanner";
import { CrmPanels } from "./CrmPanels";
import { TasksPanel } from "./TasksPanel";
import { ScoreBadge } from "../ScoreBadge";
import { SalesPanels } from "./SalesPanels";
import { FulfilmentPanels } from "./FulfilmentPanels";
import { Breadcrumbs, RelatedRecords } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Advertiser" };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The colour of an opportunity's attention flag: overdue is a problem, closing soon is worth watching. */
const attentionTone: Record<string, Tone> = {
  overdue_follow_up: "danger",
  closing_soon: "warning",
  stale: "warning",
  normal: "neutral"
};

/** A mix snapshot ({ printDigital: 3 }) as words: "Print digital 3". */
function describeMix(mix: Record<string, unknown> | undefined): string {
  const entries = Object.entries(mix ?? {});
  if (entries.length === 0) return "No data yet";
  return entries.map(([key, value]) => `${formatLabel(key)} ${String(value)}`).join(", ");
}

export default async function Advertiser360Page({ params, searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const resultCode = Array.isArray(search.result) ? search.result[0] : search.result;
  const { id } = await params;
  const result = await loadAdvertiser(request, id);

  if ("error" in result) {
    return protectedOutcome(result.error, request);
  }

  const openArtwork = result.artworkRequirements.filter((item) => item.status !== "production_ready").length;
  const openFulfilment = result.campaignFulfilments.filter((item) => item.status !== "fulfilled").length;
  const openRenewals = result.renewalPrompts.filter((item) => item.status === "open").length;
  const pipelineValue = result.opportunities.reduce((sum, view) => sum + view.opportunity.estimatedValueMinor, 0);

  return (
    <AppShell request={request}>
      <CrmBanner result={resultCode} />
      <Breadcrumbs items={[
        { label: "Commercial", href: "/app/advertisers" as Route },
        { label: result.organisation.name }
      ]} />
      <PageHeader
        eyebrow="Advertiser"
        title={result.organisation.name}
        intro="Everything about this advertiser in one place: who to talk to, what they have bought, what they owe and what happens next."
        actions={
          <>
            <LinkButton href={`/app/advertisers/${result.advertiser.id}/acceptance` as Route}>Review acceptance</LinkButton>
            <LinkButton href={"/app/advertisers/pipeline" as Route} variant="secondary">
              Pipeline
            </LinkButton>
          </>
        }
      />

      <Panel>
        <Metrics
          items={[
            { label: "Relationship", value: formatLabel(result.advertiser.relationshipState), tone: toneForStatus(result.advertiser.relationshipState) },
            { label: "Average sale", value: formatMoney(result.advertiser.averageSaleValueMinor) },
            { label: "Annual value", value: formatMoney(result.advertiser.annualAdvertiserValueMinor) },
            { label: "Owed", value: formatMoney(result.financeSummary.outstandingMinor), tone: result.financeSummary.overdueMinor > 0 ? "danger" : result.financeSummary.outstandingMinor > 0 ? "warning" : "success" },
            { label: "Pipeline", value: formatMoney(pipelineValue) },
            { label: "Proposals", value: result.proposals.length },
            { label: "Bookings", value: result.bookings.length },
            { label: "Acceptances", value: result.acceptances.length },
            { label: "Artwork open", value: openArtwork, tone: openArtwork > 0 ? "warning" : "neutral" },
            { label: "Fulfilment open", value: openFulfilment, tone: openFulfilment > 0 ? "warning" : "neutral" },
            { label: "Renewals open", value: openRenewals, tone: openRenewals > 0 ? "warning" : "neutral" }
          ]}
        />
      </Panel>

      {result.sales ? (
        <SalesAssistantPanel request={request} advertiserId={result.advertiser.id} panel={result.sales.panel} canAssist={result.sales.canAssist} senderName={result.sales.senderName} resultCode={resultCode} />
      ) : null}

      <RelatedRecords
        title="Advertiser workflow"
        records={[
          {
            label: "Pipeline",
            title: formatCount(result.opportunities.length, "opportunity", "opportunities"),
            description: "Lead and sales follow-up context",
            href: "/app/advertisers/pipeline" as Route
          },
          {
            label: "Acceptance",
            title: formatCount(result.acceptances.length, "commercial acceptance"),
            description: "Proposal acceptance and booking confirmation",
            href: `/app/advertisers/${result.advertiser.id}/acceptance` as Route
          },
          {
            label: "Edition Factory",
            title: `${formatCount(result.bookings.length, "booking")} feeding inventory`,
            description: "Accepted bookings reserve edition inventory and production handoff",
            href: "/app/editions" as Route
          },
          {
            label: "Proof Pack",
            title: formatCount(result.proofPacks.length, "proof pack"),
            description: "Campaign evidence, proof and renewal context",
            status: openRenewals > 0 ? "Renewal attention" : "No open renewal"
          }
        ]}
      />

      <CrmPanels
        request={request}
        advertiserId={result.advertiser.id}
        status={result.advertiser.status}
        notes={String(result.advertiser.commercialMetadata.internalNotes ?? "")}
        access={result.crmAccess}
      />

      <TasksPanel request={request} advertiserId={result.advertiser.id} tasks={result.tasks} opportunities={result.opportunities.filter((view) => view.state === "open").map((view) => ({ id: view.opportunity.id, title: view.opportunity.title }))} canManage={result.crmAccess.taskManage} />

      <SalesPanels request={request} view={result} catalogue={result.catalogue} access={result.salesAccess} />

      <FulfilmentPanels request={request} view={result} access={result.fulfilmentAccess} />

      <Panel eyebrow="Contacts" title="People">
        {result.contacts.length === 0 ? (
          <EmptyState title="No contacts yet">Add the people you deal with so proposals and proofs reach the right person.</EmptyState>
        ) : (
          <RecordList>
            {result.contacts.map((contact) => (
              <RecordCard
                key={contact.id}
                title={contact.name ?? contact.label}
                status={contact.isPrimary ? "primary contact" : undefined}
                tone="info"
                lines={[`${contact.role} · ${contact.email ?? "Linked platform user"}`]}
              />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Opportunities" title="Pipeline">
        {result.opportunities.length === 0 ? (
          <EmptyState title="No open opportunities yet" action={<LinkButton href={"/app/advertisers/pipeline#new" as Route} variant="secondary">Add an opportunity</LinkButton>}>
            Add one from the pipeline page.
          </EmptyState>
        ) : (
          <RecordList>
            {result.opportunities.map((view) => (
              <RecordCard
                key={view.opportunity.id}
                title={view.opportunity.title}
                status={view.attention}
                tone={attentionTone[view.attention]}
                lines={[`${view.stage.name} · ${formatMoney(view.opportunity.estimatedValueMinor)}`]}
              />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Proposals and bookings" title="Proposals">
        {result.proposals.length === 0 ? (
          <EmptyState title="No proposals yet">Proposals appear here once one has been created for this advertiser.</EmptyState>
        ) : (
          <RecordList>
            {result.proposals.map((proposal) => (
              <RecordCard
                key={proposal.id}
                title={proposal.title}
                status={proposal.status}
                lines={[`${formatMoney(proposal.totalValueMinor)} · Valid until ${formatDate(proposal.validUntil, "not set")}`]}
              />
            ))}
          </RecordList>
        )}
        <FactList
          items={[
            { label: "Commercial acceptances", value: result.acceptances.length },
            { label: "Accepted bookings", value: result.bookings.length },
            { label: "Production requests", value: result.productionRequests.length }
          ]}
        />
      </Panel>

      <Panel eyebrow="Performance" title="Latest metrics" intro="Recalculated from this advertiser's bookings.">
        <FactList
          items={[
            { label: "Package mix", value: describeMix(result.latestMetrics?.packageMix) },
            { label: "Digital mix", value: describeMix(result.latestMetrics?.digitalMix) },
            { label: "Conversion", value: formatLabel(result.latestMetrics?.conversionState, "Not yet known") },
            { label: "Churn risk", value: formatLabel(result.latestMetrics?.churnRisk, "Not yet known") }
          ]}
        />
      </Panel>

      <Panel eyebrow="Artwork" title="Production handoff">
        {result.artworkRequirements.length === 0 ? (
          <EmptyState title="No artwork requirements yet">Artwork requirements are created from confirmed booking items.</EmptyState>
        ) : (
          <RecordList>
            {result.artworkRequirements.map((requirement) => (
              <RecordCard
                key={requirement.id}
                title={formatLabel(requirement.sourceType)}
                status={requirement.status}
                lines={[
                  `Deadline ${formatDate(requirement.deadline, "not set")}`,
                  requirement.editionPageId ? "Edition placement linked" : "Awaiting page placement"
                ]}
              />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Fulfilment" title="Campaign delivery">
        {result.campaignFulfilments.length === 0 ? (
          <EmptyState title="No fulfilment records yet">Fulfilment records are created after production-ready artwork is placed or delivered.</EmptyState>
        ) : (
          <RecordList>
            {result.campaignFulfilments.map((fulfilment) => (
              <RecordCard
                key={fulfilment.id}
                title={formatLabel(fulfilment.channel)}
                status={fulfilment.status}
                lines={[
                  `Scheduled ${formatDate(fulfilment.scheduledOn, "not set")}`,
                  fulfilment.editionPageId ? "Edition placement linked" : "Awaiting placement reference"
                ]}
              />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Proof packs and renewals" title="Proof of value">
        {result.proofPacks.length === 0 ? (
          <EmptyState title="No proof packs yet">Proof packs snapshot fulfilled campaign evidence for advertiser follow-up.</EmptyState>
        ) : (
          <RecordList>
            {result.proofPacks.map((proofPack) => (
              <RecordCard
                key={proofPack.id}
                title="Proof pack"
                status={proofPack.status}
                lines={[
                  `Issued ${formatDate(proofPack.issuedAt, "not issued")} · Delivered ${formatDate(proofPack.deliveredAt, "not delivered")}`,
                  proofPack.renewalPromptId ? "Renewal prompt linked" : "No renewal prompt yet"
                ]}
              />
            ))}
          </RecordList>
        )}
        {result.renewalPrompts.length === 0 ? (
          <EmptyState title="No renewal prompts yet">Renewal prompts are created from completed proof packs.</EmptyState>
        ) : (
          <RecordList>
            {result.renewalPrompts.map((renewal) => (
              <RecordCard
                key={renewal.id}
                title="Renewal prompt"
                status={renewal.status}
                lines={[`Due ${formatDate(renewal.dueOn, "not set")}`, renewal.opportunityId ? "Opportunity linked" : "Awaiting sales follow-up"]}
              />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Finance" title="Invoices and payments">
        <Metrics
          items={[
            { label: "Invoiced", value: formatMoney(result.financeSummary.lifetimeInvoicedMinor) },
            { label: "Paid", value: formatMoney(result.financeSummary.lifetimePaidMinor) },
            { label: "Outstanding", value: formatMoney(result.financeSummary.outstandingMinor), tone: result.financeSummary.outstandingMinor > 0 ? "warning" : "success" },
            { label: "Overdue", value: formatMoney(result.financeSummary.overdueMinor), tone: result.financeSummary.overdueMinor > 0 ? "danger" : "success" }
          ]}
        />
        {result.invoices.length === 0 ? (
          <EmptyState title="No invoices yet">Invoices are raised from confirmed bookings.</EmptyState>
        ) : (
          <RecordList>
            {result.invoices.map((invoice) => (
              <RecordCard
                key={invoice.id}
                title={invoice.invoiceNumber}
                status={invoice.status}
                lines={[
                  `Due ${formatDate(invoice.dueDate, "not set")}`,
                  `${formatMoney(invoice.totalMinor)} total · ${formatMoney(invoice.balanceMinor)} outstanding`
                ]}
              />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Activity" title="Timeline">
        {result.activity.length === 0 ? (
          <EmptyState title="Nothing logged yet">Calls, meetings, emails and notes logged against this advertiser appear here.</EmptyState>
        ) : (
          <ol className="franchise-activity">
            {result.activity.map((event) => (
              <li key={event.id}>
                <strong>{event.title}</strong>
                <span>{formatLabel(event.activityType)}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </AppShell>
  );
}

async function loadAdvertiser(
  request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>,
  advertiserId: string
) {
  try {
    const shell = await requireShellPermission(request, {
      module: "advertiser",
      action: "view"
    });
    const actor = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    const view = await readAdvertiser360(actor, advertiserId);

    // The assistant never stops the page loading: if anything about it fails, the record is shown without it.
    const permissions = await getPermissionData();
    const canAssist = evaluatePermission(
      { userId: actor.userId, module: "advertiser", action: "ai_assist", context: { organisationId: actor.organisationId, territoryId: actor.territoryId } },
      permissions
    ).allowed;
    // The calculated analysis is shown to anyone who can see the record; only the AI parts need the permission.
    const sales = await readSalesPanel(actor, advertiserId).then(
      async (panel) => ({ panel, canAssist, senderName: (await getDirectory().userName(actor.userId)) ?? "" }),
      () => undefined
    );
    const allowed = (module: string, action: string) =>
      evaluatePermission({ userId: actor.userId, module, action, context: { organisationId: actor.organisationId, territoryId: actor.territoryId } }, permissions).allowed;
    const crmAccess = { edit: allowed("advertiser", "edit"), contactManage: allowed("advertiser.contact", "manage"), activityRecord: allowed("advertiser.activity", "record"), taskManage: allowed("advertiser.opportunity", "edit") };
    const salesAccess = {
      proposalCreate: allowed("advertiser.proposal", "create"),
      bookingAccept: allowed("advertiser.booking", "accept"),
      invoiceCreate: allowed("advertiser.invoice", "create"),
      invoiceIssue: allowed("advertiser.invoice", "issue"),
      paymentRecord: allowed("advertiser.payment", "record"),
      paymentAllocate: allowed("advertiser.payment", "allocate")
    };
    // Only needed to build the proposal form; a person who cannot see the catalogue just does not get one.
    const catalogue = salesAccess.proposalCreate ? await readCatalogue(actor).catch(() => undefined) : undefined;
    const fulfilmentAccess = {
      artworkManage: allowed("advertiser.artwork", "manage"),
      artworkApprove: allowed("advertiser.artwork", "approve"),
      fulfilmentManage: allowed("advertiser.fulfilment", "manage"),
      proofCreate: allowed("advertiser.proof", "create"),
      renewalManage: allowed("advertiser.renewal", "manage")
    };
    return { ...view, sales, crmAccess, salesAccess, catalogue, fulfilmentAccess };
  } catch (error) {
    return { error };
  }
}

function formatMoney(valueMinor: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(valueMinor / 100);
}
