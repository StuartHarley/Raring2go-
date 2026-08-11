import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";
import { readPublicHomepage, territoryFromSlug } from "../../../lib/public-runtime";

type PageProps = {
  params: Promise<{ territorySlug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const territory = territoryFromSlug((await params).territorySlug);

  return {
    title: territory ? `Raring2go! ${territory.name}` : "Raring2go!",
    description: territory?.strapline ?? "Local family activities, events and inspiration from Raring2go!"
  };
}

export default async function TerritoryHomepage({ params }: PageProps) {
  const homepage = await readPublicHomepage((await params).territorySlug);

  if (!homepage) {
    notFound();
  }

  return (
    <main className="public-site public-season-autumn">
      <header className="public-nav">
        <Link href={`/areas/${homepage.territory.slug}`} className="public-logo">
          Raring2go!
        </Link>
        <nav aria-label="Public navigation">
          <Link href={areaRoute(homepage.territory.slug, "whats-on")}>What&apos;s On</Link>
          <Link href={areaRoute(homepage.territory.slug, "offers")}>Offers</Link>
          <Link href={areaRoute(homepage.territory.slug, "magazine")}>Magazine</Link>
          <Link href={areaRoute(homepage.territory.slug, "saved")}>Saved</Link>
        </nav>
      </header>

      <section className="public-hero">
        <div>
          <p className="public-kicker">Raring2go! {homepage.territory.name}</p>
          <h1>{homepage.hero?.title ?? "Your local family guide"}</h1>
          <p>{homepage.hero?.summary ?? homepage.territory.strapline}</p>
          <div className="public-actions">
            <Link href={areaRoute(homepage.territory.slug, "whats-on")}>Find What&apos;s On</Link>
            <Link href={areaRoute(homepage.territory.slug, "magazine")}>Read the magazine</Link>
          </div>
        </div>
      </section>

      <section className="public-layout-note" aria-label="Homepage structure">
        {homepage.template.slots.map((slot) => (
          <span key={slot.id}>{slot.heading}</span>
        ))}
      </section>

      <PublicSection title="Latest local stories" empty={emptyFor(homepage, "stories")}>
        {homepage.stories.map((story) => <PublicCard key={story.id} card={story} />)}
      </PublicSection>

      <PublicSection title="What's on near you" empty={emptyFor(homepage, "whats_on")}>
        {homepage.whatsOn.map((story) => <PublicCard key={story.id} card={story} />)}
      </PublicSection>

      <PublicSection title="Things to do" empty={emptyFor(homepage, "things_to_do")}>
        {homepage.thingsToDo.map((story) => <PublicCard key={story.id} card={story} />)}
      </PublicSection>

      <section className="public-band">
        <div>
          <p className="public-kicker">Digital magazine</p>
          <h2>{homepage.magazine?.title ?? "The next local edition is being prepared"}</h2>
          <p>
            {homepage.magazine
              ? `Issue date ${homepage.magazine.issueDate ?? "to be confirmed"}.`
              : "Published digital editions will appear here when production output is ready for public release."}
          </p>
        </div>
        <Link href={areaRoute(homepage.territory.slug, "magazine")}>Open magazine</Link>
      </section>

      <PublicSection title="Recommended local businesses" empty={emptyFor(homepage, "advertisers")}>
        {homepage.placements.map((placement) => (
          <article key={placement.id} className="public-card public-sponsored">
            <span>{placement.label}</span>
            <h3>{placement.title}</h3>
            <p>{placement.summary}</p>
          </article>
        ))}
      </PublicSection>

      <section className="public-newsletter">
        <div>
          <p className="public-kicker">Newsletter</p>
          <h2>{homepage.newsletter.heading}</h2>
          <p>{homepage.newsletter.consentText}</p>
        </div>
        <form>
          <input aria-label="Email address" placeholder="you@example.com" type="email" />
          <button type="submit">Subscribe</button>
        </form>
      </section>
    </main>
  );
}

function PublicSection({
  title,
  empty,
  children
}: {
  title: string;
  empty?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="public-section">
      <div className="public-section-heading">
        <p className="public-kicker">Local discovery</p>
        <h2>{title}</h2>
      </div>
      <div className="public-card-grid">
        {empty ? <p className="public-empty">{empty}</p> : children}
      </div>
    </section>
  );
}

function PublicCard({
  card
}: {
  card: { href: string; source: string; type: string; title: string; summary: string };
}) {
  return (
    <Link href={card.href as Route} className="public-card">
      <span>{card.source} {card.type}</span>
      <h3>{card.title}</h3>
      <p>{card.summary}</p>
    </Link>
  );
}

function emptyFor(homepage: NonNullable<Awaited<ReturnType<typeof readPublicHomepage>>>, slot: string) {
  return homepage.emptyStates.find((state) => state.slot === slot)?.message;
}

function areaRoute(slug: string, segment: string) {
  return `/areas/${slug}/${segment}` as Route;
}
