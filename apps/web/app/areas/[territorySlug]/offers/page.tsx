import { TrackedLink } from "../_components/TrackedLink";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { readPublicCommercialDiscovery, territoryFromSlug } from "../../../../lib/public-runtime";
import { PublicNav } from "../_components/PublicNav";
import { formatCount } from "../../../../lib/format";

type PageProps = {
  params: Promise<{ territorySlug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const territory = territoryFromSlug((await params).territorySlug);

  return {
    title: { absolute: territory ? `Offers in ${territory.name} | Raring2go!` : "Offers | Raring2go!" },
    description: territory
      ? `Family offers and sponsored local recommendations around ${territory.name}.`
      : "Family offers and sponsored local recommendations from Raring2go!"
  };
}

export default async function OffersPage({ params }: PageProps) {
  const discovery = await readPublicCommercialDiscovery((await params).territorySlug, "offers");

  if (!discovery) {
    notFound();
  }

  return (
    <main className="public-site public-season-autumn">
      <CommercialHeader slug={discovery.territory.slug} />
      <section className="public-hero public-hero-compact">
        <div>
          <p className="public-kicker">Raring2go! {discovery.territory.name}</p>
          <h1>{discovery.heading}</h1>
          <p>Money off days out, classes and treats from local businesses. Sponsored offers are always marked.</p>
        </div>
      </section>
      <CommercialGrid discovery={discovery} />
    </main>
  );
}

function CommercialHeader({ slug }: { slug: string }) {
  return (
    <PublicNav slug={slug} current="offers" />
  );
}

function CommercialGrid({
  discovery
}: {
  discovery: NonNullable<Awaited<ReturnType<typeof readPublicCommercialDiscovery>>>;
}) {
  return (
    <section className="public-section">
      <div className="public-section-heading">
        <p className="public-kicker">Commercial discovery</p>
        <h2>{formatCount(discovery.items.length + discovery.placements.length, "offer")}</h2>
      </div>
      <div className="public-card-grid">
        {discovery.emptyState ? <p className="public-empty">{discovery.emptyState}</p> : null}
        {discovery.items.map((item) => (
          <TrackedLink key={item.id} territorySlug={discovery.territory.slug} path={`/areas/${discovery.territory.slug}/offers`} eventType="discovery_item_clicked" entityType="content" entityId={item.id} component="offers_card" href={item.href} className="public-card public-sponsored">
            <span>Sponsored {item.type}</span>
            <h3>{item.title}</h3>
            <p>{item.summary}</p>
          </TrackedLink>
        ))}
        {discovery.placements.map((placement) => (
          <TrackedLink key={placement.id} territorySlug={discovery.territory.slug} path={`/areas/${discovery.territory.slug}/offers`} eventType="commercial_placement_clicked" entityType="advertiser" entityId={placement.advertiserId} component="offers_placement" href={placement.href} className="public-card public-sponsored">
            <span>{placement.label}</span>
            <h3>{placement.title}</h3>
            <p>{placement.summary}</p>
          </TrackedLink>
        ))}
      </div>
    </section>
  );
}
