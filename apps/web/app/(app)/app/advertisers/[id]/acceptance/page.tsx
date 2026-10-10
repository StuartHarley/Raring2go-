import type { Route } from "next";
import { requireShellPermission } from "../../../../../../lib/app-shell";
import { readAdvertiser360 } from "../../../../../../lib/advertising-runtime";
import { formatDate, formatLabel } from "../../../../../../lib/format";
import { EmptyState, LinkButton, PageHeader, Panel, RecordCard, RecordList } from "../../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../../lib/workflow-ui";
import { requestFromSearchParamsAndCookies } from "../../../page";
import { protectedOutcome } from "../../../../../../lib/protected-outcome";

export const metadata = { title: "Commercial acceptance" };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdvertiserAcceptancePage({ params, searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const { id } = await params;
  const result = await loadAdvertiser(request, id);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Commercial", href: "/app/advertisers" as Route },
          { label: result.organisation.name, href: `/app/advertisers/${result.advertiser.id}` as Route },
          { label: "Acceptance" }
        ]}
      />
      <PageHeader
        eyebrow={result.organisation.name}
        title="Proposal acceptance"
        intro="Which proposals this advertiser has accepted, how they accepted, and the exact version they agreed to."
        actions={
          <LinkButton href={`/app/advertisers/${result.advertiser.id}` as Route} variant="secondary">
            Back to advertiser
          </LinkButton>
        }
      />

      <Panel eyebrow="Proposals" title="Current proposals">
        {result.proposals.length === 0 ? (
          <EmptyState title="No proposals yet">Acceptances appear here once a proposal has been sent and answered.</EmptyState>
        ) : (
          <RecordList>
            {result.proposals.map((proposal) => {
              const acceptance = result.acceptances.find((candidate) => candidate.proposalId === proposal.id);

              return (
                <RecordCard
                  key={proposal.id}
                  title={proposal.title}
                  status={proposal.status}
                  lines={[
                    `Version ${proposal.version} · Valid until ${formatDate(proposal.validUntil, "not set")}`,
                    acceptance ? `${formatLabel(acceptance.status)} by ${formatLabel(acceptance.method)}` : "Awaiting a response"
                  ]}
                />
              );
            })}
          </RecordList>
        )}
      </Panel>
    </>
  );
}

async function loadAdvertiser(
  request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>,
  advertiserId: string
) {
  try {
    const shell = await requireShellPermission(request, {
      module: "advertiser.proposal",
      action: "view"
    });
    return await readAdvertiser360(
      {
        userId: shell.userId,
        organisationId: shell.activeContext.organisationId,
        territoryId: shell.activeContext.territoryId
      },
      advertiserId
    );
  } catch (error) {
    return { error };
  }
}
