import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { listAdvertiser360Rows } from "../../../../lib/advertising-runtime";
import { getDirectory } from "../../../../lib/directory";
import { displayName } from "../../../../lib/format";
import { EmptyState, LinkButton, Metrics, PageHeader, Panel, RecordLink, RecordList } from "../../../../lib/page-ui";
import { createAdvertiserAction } from "./actions";
import { CrmBanner } from "./CrmBanner";
import { requestFromSearchParamsAndCookies } from "../page";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Advertisers" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdvertisersPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);
  const resultCode = Array.isArray(params.result) ? params.result[0] : params.result;
  const result = await loadAdvertisers(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const retained = result.advertisers.filter((row) => row.advertiser.relationshipState === "retained").length;
  const annualValue = result.advertisers.reduce(
    (total, row) => total + row.advertiser.annualAdvertiserValueMinor,
    0
  );

  return (
    <>
      <CrmBanner result={resultCode} />
      <PageHeader
        eyebrow="Commercial"
        title="Advertisers"
        intro="The businesses advertising with you: who they are, what they are worth, and what needs chasing next."
        actions={
          <>
            <LinkButton href={"/app/advertisers/pipeline" as Route}>Open pipeline</LinkButton>
            <LinkButton href={"/app/advertisers/catalogue" as Route} variant="secondary">
              Catalogue
            </LinkButton>
            <LinkButton href={"/app/advertisers/command-centre" as Route} variant="secondary">
              Commercial command
            </LinkButton>
            {result.canImport ? (
              <LinkButton href={"/app/advertisers/import" as Route} variant="secondary">
                Import a list
              </LinkButton>
            ) : null}
          </>
        }
      />

      <Panel>
        <Metrics
          items={[
            { label: "Advertisers", value: result.advertisers.length },
            { label: "Retained", value: retained, detail: `${result.advertisers.length - retained} not yet retained`, tone: retained > 0 ? "success" : "neutral" },
            { label: "Annual value", value: formatMoney(annualValue) }
          ]}
        />
      </Panel>

      <Panel eyebrow="Accounts" title="All advertisers">
        {result.advertisers.length === 0 ? (
          <EmptyState title="No advertisers yet">Add the first one below, or import a list from Audience.</EmptyState>
        ) : (
          <RecordList>
            {result.advertisers.map((row) => (
              <RecordLink
                key={row.advertiser.id}
                href={`/app/advertisers/${row.advertiser.id}` as Route}
                title={row.organisation.name}
                status={row.advertiser.relationshipState}
                lines={[
                  displayName(row.territory?.name, "Territory not named yet"),
                  `Average sale ${formatMoney(row.advertiser.averageSaleValueMinor)} · Annual value ${formatMoney(row.advertiser.annualAdvertiserValueMinor)}`
                ]}
              />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="New advertiser" title="Add an advertiser" id="new">
        <form action={createAdvertiserAction.bind(null, request)} className="franchise-form">
          <label>
            Business name
            <input name="name" required maxLength={120} />
          </label>
          <label>
            Area
            <select name="territoryId" required defaultValue={request.territoryId ?? ""}>
              {result.territories.map((territory) => (
                <option key={territory.id} value={territory.id}>{territory.name}</option>
              ))}
            </select>
          </label>
          <label>
            How did they find us?
            <input name="source" maxLength={80} placeholder="Referral, event, cold call" />
          </label>
          <button type="submit" className="r2-button r2-button--primary">
            Create advertiser
          </button>
        </form>
      </Panel>
    </>
  );
}

async function loadAdvertisers(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "advertiser",
      action: "view"
    });
    const advertisers = await listAdvertiser360Rows({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    const directory = getDirectory();
    const territories = shell.activeContext.territoryId
      ? (await directory.listTerritories()).filter((territory) => territory.id === shell.activeContext.territoryId)
      : await directory.listTerritories();

    const canImport = await requireShellPermission(request, { module: "advertiser.import", action: "manage" }).then(() => true, (error) => {
      if (error instanceof ShellAccessError) return false;
      throw error;
    });

    return { advertisers, territories, canImport };
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
