import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";
import { readPublicDiscovery, territoryFromSlug } from "../../../../lib/public-runtime";

type PageProps = {
  params: Promise<{ territorySlug: string }>;
  searchParams: Promise<{ q?: string; category?: string; date?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const territory = territoryFromSlug((await params).territorySlug);

  return {
    title: territory ? `Activities in ${territory.name} | Raring2go!` : "Activities | Raring2go!",
    description: territory
      ? `Family activities, ideas and local inspiration around ${territory.name}.`
      : "Family activities, ideas and local inspiration from Raring2go!"
  };
}

export default async function ActivitiesPage({ params, searchParams }: PageProps) {
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;
  const discovery = await readPublicDiscovery(resolvedParams.territorySlug, "activities", {
    query: resolvedSearch.q,
    category: resolvedSearch.category,
    date: filterDate(resolvedSearch.date)
  });

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
          <Link href={`/areas/${discovery.territory.slug}/magazine` as Route}>Magazine</Link>
        </nav>
      </header>

      <section className="public-hero public-hero-compact">
        <div>
          <p className="public-kicker">Raring2go! {discovery.territory.name}</p>
          <h1>{discovery.heading}</h1>
          <p>Browse approved family ideas, guides and things to do from the local Raring2go editorial workflow.</p>
        </div>
      </section>

      <form className="public-filters" action={`/areas/${discovery.territory.slug}/activities`}>
        <input name="q" aria-label="Search activities" placeholder="Search by keyword" defaultValue={discovery.filters.query} />
        <select name="category" aria-label="Filter by category" defaultValue={discovery.filters.category}>
          <option value="all">All categories</option>
          {discovery.availableCategories.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select name="date" aria-label="Filter by date" defaultValue={discovery.filters.date}>
          <option value="all">Any time</option>
          <option value="today">Today</option>
          <option value="weekend">Weekend</option>
          <option value="school_holidays">School holidays</option>
        </select>
        <button type="submit">Filter</button>
      </form>

      <section className="public-section">
        <div className="public-section-heading">
          <p className="public-kicker">Family inspiration</p>
          <h2>{discovery.items.length} public activities</h2>
        </div>
        <div className="public-card-grid">
          {discovery.emptyState ? <p className="public-empty">{discovery.emptyState}</p> : null}
          {discovery.items.map((item) => (
            <Link key={item.id} href={item.href as Route} className="public-card">
              <span>{item.source} {item.type}</span>
              <h3>{item.title}</h3>
              <p>{item.summary}</p>
              <small>{item.categories.join(", ") || "Family guide"}</small>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

function filterDate(value?: string) {
  return value === "today" || value === "weekend" || value === "school_holidays" ? value : "all";
}
