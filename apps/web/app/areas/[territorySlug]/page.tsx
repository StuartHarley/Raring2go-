import Link from "next/link";
import { TrackedLink } from "./_components/TrackedLink";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";
import { requestSignInAction } from "../../sign-in/actions";
import { NewsletterSignup } from "./_components/NewsletterSignup";
import { JsonLd, PublicNav } from "./_components/PublicNav";
import { Track } from "./_components/Track";
import { formatDate, formatLabel } from "../../../lib/format";
import { publicTerritoryStructuredData, readPublicHomepage, territoryFromSlug } from "../../../lib/public-runtime";

type PageProps = {
  params: Promise<{ territorySlug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const territory = territoryFromSlug((await params).territorySlug);

  return {
    title: { absolute: territory ? `Raring2go! ${territory.name}` : "Raring2go!" },
    description: territory?.strapline ?? "Local family activities, events and inspiration from Raring2go!"
  };
}

export default async function TerritoryHomepage({ params }: PageProps) {
  const homepage = await readPublicHomepage((await params).territorySlug);

  if (!homepage) {
    notFound();
  }

  const slug = homepage.territory.slug;

  return (
    <main className="public-site public-season-autumn">
      <Track eventType="territory_viewed" territorySlug={slug} path={`/areas/${slug}`} />
      <JsonLd data={publicTerritoryStructuredData(homepage, process.env.NEXT_PUBLIC_SITE_URL) as Record<string, unknown>} />
      <PublicNav slug={slug} />

      {homepage.template.slots
        .filter((slot) => slot.visible)
        .map((slot) => (
          <HomepageSlot key={slot.id} slot={slot} homepage={homepage} />
        ))}
    </main>
  );
}

type Homepage = NonNullable<Awaited<ReturnType<typeof readPublicHomepage>>>;

/** One section of the homepage, drawn from the live layout HQ controls: its order, heading and item count come from the template. */
function HomepageSlot({ slot, homepage }: { slot: Homepage["template"]["slots"][number]; homepage: Homepage }) {
  const slug = homepage.territory.slug;
  const cards = (items: Homepage["stories"], sponsored = false) =>
    items.map((card) => <PublicCard key={card.id} card={card} territorySlug={slug} sponsored={sponsored} />);

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
      return (
        <PublicSection
          title={slot.heading}
          count={homepage.stories.length}
          empty={emptyFor(homepage, "stories") ?? "Local stories are on their way. Check back soon."}
          more={{ href: areaRoute(slug, "activities"), label: "Browse activities" }}
        >
          {cards(homepage.stories)}
        </PublicSection>
      );
    case "whats_on":
      return (
        <PublicSection
          title={slot.heading}
          count={homepage.whatsOn.length}
          empty="No events listed for the coming days yet. The What's On page has everything we know about."
          more={{ href: areaRoute(slug, "whats-on"), label: "See all events" }}
        >
          {cards(homepage.whatsOn)}
        </PublicSection>
      );
    case "things_to_do":
      return (
        <PublicSection
          title={slot.heading}
          count={homepage.thingsToDo.length}
          empty="Ideas and guides for days out are being written. In the meantime, the magazine is full of them."
          more={{ href: areaRoute(slug, "activities"), label: "All things to do" }}
        >
          {cards(homepage.thingsToDo)}
        </PublicSection>
      );
    case "offers":
      return (
        <PublicSection
          title={slot.heading}
          kicker="Sponsored"
          count={homepage.offers.length}
          empty={emptyFor(homepage, "offers") ?? "Offers from local businesses will appear here as soon as they go live."}
          more={{ href: areaRoute(slug, "offers"), label: "All offers" }}
        >
          {cards(homepage.offers, true)}
        </PublicSection>
      );
    case "competitions":
      return (
        <PublicSection
          title={slot.heading}
          kicker="Sponsored"
          count={homepage.competitions.length}
          empty={emptyFor(homepage, "competitions") ?? "New competitions will appear here as soon as they open."}
          more={{ href: areaRoute(slug, "competitions"), label: "All competitions" }}
        >
          {cards(homepage.competitions, true)}
        </PublicSection>
      );
    case "advertisers":
      return (
        <PublicSection
          title={slot.heading}
          kicker="Sponsored"
          count={homepage.placements.length}
          empty={emptyFor(homepage, "advertisers") ?? "Local businesses recommended by Raring2go! will appear here soon."}
          more={{ href: areaRoute(slug, "businesses"), label: "All local businesses" }}
        >
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
            <h2>{homepage.magazine?.title ?? "The next edition is on its way"}</h2>
            <p>
              {homepage.magazine
                ? `Out ${formatDate(homepage.magazine.issueDate, "soon")}. Read it online, page by page.`
                : "We will put the next magazine here as soon as it is published. Until then, the latest stories are above."}
            </p>
          </div>
          <Link href={areaRoute(slug, "magazine")}>{homepage.magazine ? "Open the magazine" : "See past editions"}</Link>
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
  count,
  empty,
  more,
  children
}: {
  title: string;
  kicker?: string;
  count: number;
  empty: string;
  more?: { href: Route; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="public-section">
      <div className="public-section-heading">
        <div>
          <p className="public-kicker">{kicker}</p>
          <h2>{title}</h2>
        </div>
        {more && count > 0 ? (
          <Link href={more.href} className="public-more">
            {more.label}
          </Link>
        ) : null}
      </div>
      {count === 0 ? (
        <div className="public-empty">
          <p>{empty}</p>
          {more ? <Link href={more.href}>{more.label}</Link> : null}
        </div>
      ) : (
        <div className="public-card-grid">{children}</div>
      )}
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
  const label = sponsored ? "Sponsored" : card.source === "network" ? `${formatLabel(card.type)} · From Raring2go!` : formatLabel(card.type);
  return (
    <TrackedLink territorySlug={territorySlug} path={`/areas/${territorySlug}`} eventType="discovery_item_clicked" entityType="content" entityId={card.id} component="homepage_card" href={card.href} className="public-card">
      <span>{label}</span>
      <h3>{card.title}</h3>
      <p>{card.summary}</p>
    </TrackedLink>
  );
}

function emptyFor(homepage: Homepage, slot: string) {
  return homepage.emptyStates.find((state) => state.slot === slot)?.message;
}

function areaRoute(slug: string, segment: string) {
  return `/areas/${slug}/${segment}` as Route;
}
