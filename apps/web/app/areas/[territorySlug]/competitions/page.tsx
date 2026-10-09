import Link from "next/link";
import { TrackedLink } from "../_components/TrackedLink";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";
import { readPublicCommercialDiscovery, territoryFromSlug } from "../../../../lib/public-runtime";

type PageProps = {
  params: Promise<{ territorySlug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const territory = territoryFromSlug((await params).territorySlug);

  return {
    title: territory ? `Competitions in ${territory.name} | Raring2go!` : "Competitions | Raring2go!",
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
      <header className="public-nav">
        <Link href={`/areas/${discovery.territory.slug}` as Route} className="public-logo">Raring2go!</Link>
        <nav aria-label="Public navigation">
          <Link href={`/areas/${discovery.territory.slug}/whats-on` as Route}>What&apos;s On</Link>
          <Link href={`/areas/${discovery.territory.slug}/activities` as Route}>Activities</Link>
          <Link href={`/areas/${discovery.territory.slug}/offers` as Route}>Offers</Link>
          <Link href={`/areas/${discovery.territory.slug}/competitions` as Route}>Competitions</Link>
          <Link href={`/areas/${discovery.territory.slug}/businesses` as Route}>Businesses</Link>
        </nav>
      </header>
      <section className="public-hero public-hero-compact">
        <div>
          <p className="public-kicker">Raring2go! {discovery.territory.name}</p>
          <h1>{discovery.heading}</h1>
          <p>Approved competitions from local and network content workflows, with no draft or unapproved records exposed.</p>
        </div>
      </section>
      <section className="public-section">
        <div className="public-section-heading">
          <p className="public-kicker">Commercial discovery</p>
          <h2>{discovery.items.length + discovery.placements.length} public competitions</h2>
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
