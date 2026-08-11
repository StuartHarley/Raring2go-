import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readCatalogue } from "../../../../../lib/advertising-runtime";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdvertiserCataloguePage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadCatalogue(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Commercial catalogue</p>
        <h2>Products, pricing and inventory</h2>
        <p>
          Configurable sellable products, package definitions, network price
          books and Edition Factory inventory slots for future bookings.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Products</span>
            <strong>{result.catalogue.products.length}</strong>
          </article>
          <article>
            <span>Packages</span>
            <strong>{result.catalogue.packages.length}</strong>
          </article>
          <article>
            <span>Price books</span>
            <strong>{result.catalogue.priceBooks.length}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Products</p>
        <h2>Sellable catalogue</h2>
        <div className="franchise-list">
          {result.catalogue.products.map((product) => {
            const item = result.catalogue.priceBookItems.find((candidate) => candidate.productId === product.id);

            return (
              <div key={product.id}>
                <strong>{product.name}</strong>
                <span>{product.channel} - {product.requiresInventory ? "inventory-backed" : "non-inventory"}</span>
                <span>
                  {item
                    ? `${formatMoney(item.standardPriceMinor, item.currency)} standard, ${formatMoney(item.minimumPriceMinor, item.currency)} minimum`
                    : "No active price"}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Edition inventory</p>
        <h2>Available slots</h2>
        <div className="franchise-facts">
          {result.catalogue.inventorySlots.map((slot) => (
            <div key={slot.id}>
              <dt>{slot.slotKey}</dt>
              <dd>{slot.status}</dd>
              <small>{slot.inventoryClass} - {slot.exclusive ? "exclusive" : "shareable"}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Packages</p>
        <h2>Commercial bundles</h2>
        <div className="franchise-list">
          {result.catalogue.packages.map((bundle) => (
            <div key={bundle.id}>
              <strong>{bundle.name}</strong>
              <span>{bundle.status}</span>
              <span>{bundle.lines.length} line item{bundle.lines.length === 1 ? "" : "s"}</span>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
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

function protectedOutcome(error: unknown) {
  if (error instanceof ShellAccessError) {
    return (
      <main className={`app-outcome app-outcome-${error.kind}`}>
        <section>
          <p className="eyebrow">{error.kind.replace("_", " ")}</p>
          <h1>{error.kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1>
          <p>{error.message}</p>
        </section>
      </main>
    );
  }

  throw error;
}
