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
    title: { absolute: territory ? `Competitions in ${territory.name} | Raring2go!` : "Competitions | Raring2go!" },
    description: territory
      ? `Family competitions and prizes around ${territory.name}.`
      : "Family competitions and prizes from Raring2go!"
  };
}

export default async function CompetitionsPage({ params }: PageProps) {
  const discovery = await readPublicCommercialDiscovery((await params).territorySlug, "competitions");

  if (!discovery) {
    notFound();
  }

  return (
    <main className="public-site public-season-autumn">
      <PublicNav slug={discovery.territory.slug} current="competitions" />
      <section className="public-hero public-hero-compact">
        <div>
          <p className="public-kicker">Raring2go! {discovery.territory.name}</p>
          <h1>{discovery.heading}</h1>
          <p>Win family days out, tickets and treats. Every competition here is open to enter now.</p>
        </div>
      </section>
      <section className="public-section">
        <div className="public-section-heading">
          <p className="public-kicker">Commercial discovery</p>
          <h2>{formatCount(discovery.items.length + discovery.placements.length, "competition")}</h2>
        </div>
        <div className="public-card-grid">
          {discovery.emptyState ? <p className="public-empty">{discovery.emptyState}</p> : null}
          {discovery.items.map((item) => (
            <TrackedLink key={item.id} territorySlug={discovery.territory.slug} path={`/areas/${discovery.territory.slug}/competitions`} eventType="discovery_item_clicked" entityType="content" entityId={item.id} component="competitions_card" href={item.href} className="public-card public-sponsored">
              <span>Sponsored competition</span>
              <h3>{item.title}</h3>
              <p>{item.summary}</p>
            </TrackedLink>
          ))}
          {discovery.placements.map((placement) => (
            <TrackedLink key={placement.id} territorySlug={discovery.territory.slug} path={`/areas/${discovery.territory.slug}/competitions`} eventType="commercial_placement_clicked" entityType="advertiser" entityId={placement.advertiserId} component="competitions_placement" href={placement.href} className="public-card public-sponsored">
              <span>{placement.label}</span>
              <h3>{placement.title}</h3>
              <p>{placement.summary}</p>
            </TrackedLink>
          ))}
        </div>
      </section>
    </main>
  );
}
