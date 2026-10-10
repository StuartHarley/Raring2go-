import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { readCatalogue } from "../../../../../lib/advertising-runtime";
import { formatCount, formatLabel } from "../../../../../lib/format";
import { EmptyState, LinkButton, Metrics, PageHeader, Panel, RecordCard, RecordList } from "../../../../../lib/page-ui";
import { requestFromSearchParamsAndCookies } from "../../page";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Commercial catalogue" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdvertiserCataloguePage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadCatalogue(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { catalogue } = result;

  return (
    <>
      <PageHeader
        eyebrow="Commercial"
        title="Catalogue"
        intro="What you can sell, what it costs in this area, and which edition slots are still free to book."
        actions={
          <>
            <LinkButton href={"/app/advertisers/pipeline" as Route}>Open pipeline</LinkButton>
            <LinkButton href={"/app/advertisers" as Route} variant="secondary">
              All advertisers
            </LinkButton>
          </>
        }
      />

      <Panel>
        <Metrics
          items={[
            { label: "Products", value: catalogue.products.length },
            { label: "Packages", value: catalogue.packages.length },
            { label: "Price books", value: catalogue.priceBooks.length }
          ]}
        />
      </Panel>

      <Panel eyebrow="Products" title="What you can sell">
        {catalogue.products.length === 0 ? (
          <EmptyState title="No products yet">Products and their prices are set up by Head Office before they can be sold.</EmptyState>
        ) : (
          <RecordList>
            {catalogue.products.map((product) => {
              const item = catalogue.priceBookItems.find((candidate) => candidate.productId === product.id);

              return (
                <RecordCard
                  key={product.id}
                  title={product.name}
                  status={product.status}
                  lines={[
                    `${formatLabel(product.channel)} · ${product.requiresInventory ? "Takes an edition slot" : "No slot needed"}`,
                    item
                      ? `${formatMoney(item.standardPriceMinor, item.currency)} standard, ${formatMoney(item.minimumPriceMinor, item.currency)} minimum`
                      : "No active price in this area"
                  ]}
                />
              );
            })}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Edition inventory" title="Slots">
        {catalogue.inventorySlots.length === 0 ? (
          <EmptyState title="No slots yet">Slots appear once an edition has been planned for this area.</EmptyState>
        ) : (
          <RecordList>
            {catalogue.inventorySlots.map((slot) => (
              <RecordCard
                key={slot.id}
                title={slot.slotKey}
                status={slot.status}
                tone={slot.status === "available" ? "success" : undefined}
                lines={[`${formatLabel(slot.inventoryClass)} · ${slot.exclusive ? "Exclusive to one advertiser" : "Can be shared"}`]}
              />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Packages" title="Bundles">
        {catalogue.packages.length === 0 ? (
          <EmptyState title="No packages yet">A package bundles several products at one price.</EmptyState>
        ) : (
          <RecordList>
            {catalogue.packages.map((bundle) => (
              <RecordCard key={bundle.id} title={bundle.name} status={bundle.status} lines={[formatCount(bundle.lines.length, "line item")]} />
            ))}
          </RecordList>
        )}
      </Panel>
    </>
  );
}

async function loadCatalogue(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "advertiser.catalogue",
      action: "view"
    });
    const catalogue = await readCatalogue({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    return { catalogue };
  } catch (error) {
    return { error };
  }
}

function formatMoney(valueMinor: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(valueMinor / 100);
}
