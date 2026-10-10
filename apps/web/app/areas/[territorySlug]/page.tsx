import Link from "next/link";
import { TrackedLink } from "./_components/TrackedLink";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";
import { requestSignInAction } from "../../sign-in/actions";
import { NewsletterSignup } from "./_components/NewsletterSignup";
import { Track } from "./_components/Track";
import { publicTerritoryStructuredData, readPublicHomepage, territoryFromSlug } from "../../../lib/public-runtime";

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
      <Track eventType="territory_viewed" territorySlug={homepage.territory.slug} path={`/areas/${homepage.territory.slug}`} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(publicTerritoryStructuredData(homepage, process.env.NEXT_PUBLIC_SITE_URL))
        }}
      />
      <header className="public-nav">
        <Link href={`/areas/${homepage.territory.slug}`} className="public-logo">
          Raring2go!
        </Link>
        <nav aria-label="Public navigation">
          <Link href={areaRoute(homepage.territory.slug, "whats-on")}>What&apos;s On</Link>
          <Link href={areaRoute(homepage.territory.slug, "activities")}>Activities</Link>
          <Link href={areaRoute(homepage.territory.slug, "offers")}>Offers</Link>
          <Link href={areaRoute(homepage.territory.slug, "competitions")}>Competitions</Link>
          <Link href={areaRoute(homepage.territory.slug, "businesses")}>Businesses</Link>
          <Link href={areaRoute(homepage.territory.slug, "for-you")}>For You</Link>
          <Link href={areaRoute(homepage.territory.slug, "magazine")}>Magazine</Link>
          <Link href={areaRoute(homepage.territory.slug, "saved")}>Saved</Link>
        </nav>
      </header>

      {homepage.template.slots.filter((slot) => slot.visible).map((slot) => (
        <HomepageSlot key={slot.id} slot={slot} homepage={homepage} />
      ))}
    </main>
  );
}

type Homepage = NonNullable<Awaited<ReturnType<typeof readPublicHomepage>>>;

/** One section of the homepage, drawn from the live layout HQ controls: its order, heading and item count come from the template. */
function HomepageSlot({ slot, homepage }: { slot: Homepage["template"]["slots"][number]; homepage: Homepage }) {
  const slug = homepage.territory.slug;
  const cards = (items: Homepage["stories"], sponsored = false) => items.map((card) => <PublicCard key={card.id} card={card} territorySlug={slug} sponsored={sponsored} />);
  switch (slot.kind) {
    case "hero":
      return (
        <section className="public-hero">
          <div>
            <p className="public-kicker">Raring2go! {homepage.territory.name}</p>
            <h1>{homepage.hero?.title ?? slot.heading}</h1>
            <p>{homepage.hero?.summary ?? homepage.territory.strapline}</p>
            <div className="public-actions">
              <Link href={areaRoute(slug, "whats-on")}>Find What&apos;s On</Link>
              <Link href={areaRoute(slug, "magazine")}>Read the magazine</Link>
            </div>
          </div>
        </section>
      );
    case "stories":
      return <PublicSection title={slot.heading} empty={emptyFor(homepage, "stories")}>{cards(homepage.stories)}</PublicSection>;
    case "whats_on":
      return <PublicSection title={slot.heading}>{cards(homepage.whatsOn)}</PublicSection>;
    case "things_to_do":
      return <PublicSection title={slot.heading}>{cards(homepage.thingsToDo)}</PublicSection>;
    case "offers":
      return <PublicSection title={slot.heading} kicker="Sponsored" empty={emptyFor(homepage, "offers")}>{cards(homepage.offers, true)}</PublicSection>;
    case "competitions":
      return <PublicSection title={slot.heading} kicker="Sponsored" empty={emptyFor(homepage, "competitions")}>{cards(homepage.competitions, true)}</PublicSection>;
    case "advertisers":
      return (
        <PublicSection title={slot.heading} kicker="Sponsored" empty={emptyFor(homepage, "advertisers")}>
          {homepage.placements.map((placement) => (
            <article key={placement.id} className="public-card public-sponsored">
              <span>{placement.label}</span>
              <h3>{placement.title}</h3>
              <p>{placement.summary}</p>
            </article>
          ))}
        </PublicSection>
      );
    case "magazine":
      return (
        <section className="public-band">
          <div>
            <p className="public-kicker">{slot.heading}</p>
            <h2>{homepage.magazine?.title ?? "The next local edition is being prepared"}</h2>
            <p>
              {homepage.magazine
                ? `Issue date ${homepage.magazine.issueDate ?? "to be confirmed"}.`
                : "Published digital editions will appear here when production output is ready for public release."}
            </p>
          </div>
          <Link href={areaRoute(slug, "magazine")}>Open magazine</Link>
        </section>
      );
    case "newsletter":
      return (
        <section className="public-newsletter">
          <div>
            <p className="public-kicker">{slot.heading}</p>
            <h2>{homepage.newsletter.heading}</h2>
            <p>{homepage.newsletter.consentText}</p>
          </div>
          <NewsletterSignup territorySlug={slug} territoryId={homepage.newsletter.territoryId} action={requestSignInAction} />
        </section>
      );
    default:
      // A section this site cannot draw (the template rules keep these out) is skipped rather than shown half-built.
      return null;
  }
}

function PublicSection({
  title,
  kicker = "Local discovery",
  empty,
  children
}: {
  title: string;
  kicker?: string;
  empty?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="public-section">
      <div className="public-section-heading">
        <p className="public-kicker">{kicker}</p>
        <h2>{title}</h2>
      </div>
      <div className="public-card-grid">
        {empty ? <p className="public-empty">{empty}</p> : children}
      </div>
    </section>
  );
}

function PublicCard({
  card,
  territorySlug,
  sponsored = false
}: {
  card: { id: string; href: string; source: string; type: string; title: string; summary: string };
  territorySlug: string;
  sponsored?: boolean;
}) {
  return (
    <TrackedLink territorySlug={territorySlug} path={`/areas/${territorySlug}`} eventType="discovery_item_clicked" entityType="content" entityId={card.id} component="homepage_card" href={card.href} className="public-card">
      <span>{sponsored ? "Sponsored" : `${card.source} ${card.type}`}</span>
      <h3>{card.title}</h3>
      <p>{card.summary}</p>
    </TrackedLink>
  );
}

function emptyFor(homepage: NonNullable<Awaited<ReturnType<typeof readPublicHomepage>>>, slot: string) {
  return homepage.emptyStates.find((state) => state.slot === slot)?.message;
}

function areaRoute(slug: string, segment: string) {
  return `/areas/${slug}/${segment}` as Route;
}
