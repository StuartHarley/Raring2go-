import { TrackedLink } from "../_components/TrackedLink";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { toggleSavedContentAction } from "../preferences/actions";
import { readPublicDiscovery, territoryFromSlug } from "../../../../lib/public-runtime";
import { PublicNav } from "../_components/PublicNav";
import { formatCount } from "../../../../lib/format";

type PageProps = {
  params: Promise<{ territorySlug: string }>;
  searchParams: Promise<{ q?: string; category?: string; date?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const territory = territoryFromSlug((await params).territorySlug);

  return {
    title: { absolute: territory ? `What's On in ${territory.name} | Raring2go!` : "What's On | Raring2go!" },
    description: territory
      ? `Family events and local things to do around ${territory.name}.`
      : "Family events and local things to do from Raring2go!"
  };
}

export default async function WhatsOnPage({ params, searchParams }: PageProps) {
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;
  const discovery = await readPublicDiscovery(resolvedParams.territorySlug, "whats_on", {
    query: resolvedSearch.q,
    category: resolvedSearch.category,
    date: filterDate(resolvedSearch.date)
  });

  if (!discovery) {
    notFound();
  }

  return (
    <main className="public-site public-season-autumn">
      <PublicNav slug={discovery.territory.slug} current="whats-on" />
      <DiscoveryHero
        kicker={`Raring2go! ${discovery.territory.name}`}
        title={discovery.heading}
        summary="Family events near you this week and beyond: classes, shows, festivals and days out."
      />
      <DiscoveryFilters
        slug={discovery.territory.slug}
        path="whats-on"
        query={discovery.filters.query}
        category={discovery.filters.category}
        date={discovery.filters.date}
        categories={discovery.availableCategories}
      />
      <section className="public-section">
        <div className="public-section-heading">
          <p className="public-kicker">Local discovery</p>
          <h2>{formatCount(discovery.items.length, "event")}</h2>
        </div>
        <div className="public-card-grid">
          {discovery.emptyState ? <p className="public-empty">{discovery.emptyState}</p> : null}
          {discovery.items.map((item) => (
            <article key={item.id} className="public-card">
              <TrackedLink territorySlug={discovery.territory.slug} path={`/areas/${discovery.territory.slug}/whats-on`} eventType="discovery_item_clicked" entityType="content" entityId={item.id} component="whats_on_card" href={item.href}>
                <span>{item.source} event</span>
                <h3>{item.title}</h3>
                <p>{item.summary}</p>
                <small>{item.startDate ?? "Date to be confirmed"}{item.location ? ` · ${item.location}` : ""}</small>
              </TrackedLink>
              <form action={toggleSavedContentAction.bind(null, discovery.territory.slug, item.id, true, `/areas/${discovery.territory.slug}/whats-on`)}>
                <button type="submit">Save</button>
              </form>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function filterDate(value?: string) {
  return value === "today" || value === "weekend" || value === "school_holidays" ? value : "all";
}


function DiscoveryHero({ kicker, title, summary }: { kicker: string; title: string; summary: string }) {
  return (
    <section className="public-hero public-hero-compact">
      <div>
        <p className="public-kicker">{kicker}</p>
        <h1>{title}</h1>
        <p>{summary}</p>
      </div>
    </section>
  );
}

function DiscoveryFilters({
  slug,
  path,
  query,
  category,
  date,
  categories
}: {
  slug: string;
  path: string;
  query: string;
  category: string;
  date: string;
  categories: string[];
}) {
  return (
    <form className="public-filters" action={`/areas/${slug}/${path}`}>
      <input name="q" aria-label="Search discovery" placeholder="Search by keyword" defaultValue={query} />
      <select name="category" aria-label="Filter by category" defaultValue={category}>
        <option value="all">All categories</option>
        {categories.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <select name="date" aria-label="Filter by date" defaultValue={date}>
        <option value="all">Any time</option>
        <option value="today">Today</option>
        <option value="weekend">Weekend</option>
        <option value="school_holidays">School holidays</option>
      </select>
      <button type="submit">Filter</button>
    </form>
  );
}
