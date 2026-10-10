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
    title: { absolute: territory ? `Local Businesses in ${territory.name} | Raring2go!` : "Local Businesses | Raring2go!" },
    description: territory
      ? `Family-friendly local businesses around ${territory.name}.`
      : "Family-friendly local businesses from Raring2go!"
  };
}

export default async function BusinessesPage({ params }: PageProps) {
  const discovery = await readPublicCommercialDiscovery((await params).territorySlug, "businesses");

  if (!discovery) {
    notFound();
  }

  return (
    <main className="public-site public-season-autumn">
      <PublicNav slug={discovery.territory.slug} current="businesses" />
      <section className="public-hero public-hero-compact">
        <div>
          <p className="public-kicker">Raring2go! {discovery.territory.name}</p>
          <h1>{discovery.heading}</h1>
          <p>Classes, clubs, venues and services that local families rely on, recommended by Raring2go!</p>
        </div>
      </section>
      <section className="public-section">
        <div className="public-section-heading">
          <p className="public-kicker">Local businesses</p>
          <h2>{formatCount(discovery.placements.length, "local business", "local businesses")}</h2>
        </div>
        <div className="public-card-grid">
          {discovery.emptyState ? <p className="public-empty">{discovery.emptyState}</p> : null}
          {discovery.placements.map((placement) => (
            <TrackedLink key={placement.id} territorySlug={discovery.territory.slug} path={`/areas/${discovery.territory.slug}/businesses`} eventType="commercial_placement_clicked" entityType="advertiser" entityId={placement.advertiserId} component="businesses_placement" href={placement.href} className="public-card public-sponsored">
              <span>{placement.label}</span>
              <h3>{placement.title}</h3>
              <p>{placement.summary}</p>
              <small>{placement.tags?.join(", ") || "Family-friendly"}</small>
            </TrackedLink>
          ))}
        </div>
      </section>
    </main>
  );
}
