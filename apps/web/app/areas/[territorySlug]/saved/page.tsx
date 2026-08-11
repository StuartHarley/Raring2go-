import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";
import { sessionCookieName } from "../../../../lib/auth-runtime";
import { readSessionBackedParentHub } from "../../../../lib/parent-runtime";
import { territoryFromSlug } from "../../../../lib/public-runtime";

type PageProps = {
  params: Promise<{ territorySlug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const territory = territoryFromSlug((await params).territorySlug);

  return {
    title: territory ? `Saved | Raring2go! ${territory.name}` : "Saved | Raring2go!",
    description: "Saved family content, followed areas and parent preferences from Raring2go!"
  };
}

export default async function SavedPage({ params }: PageProps) {
  const resolvedParams = await params;
  const cookieStore = await cookies();
  const hub = await readSessionBackedParentHub(
    resolvedParams.territorySlug,
    cookieStore.get(sessionCookieName)?.value
  );

  if (!hub) {
    notFound();
  }

  return (
    <main className="public-site public-season-autumn">
      <header className="public-nav">
        <Link href={`/areas/${hub.territory.slug}` as Route} className="public-logo">Raring2go!</Link>
        <nav aria-label="Public navigation">
          <Link href={`/areas/${hub.territory.slug}/whats-on` as Route}>What&apos;s On</Link>
          <Link href={`/areas/${hub.territory.slug}/activities` as Route}>Activities</Link>
          <Link href={`/areas/${hub.territory.slug}/offers` as Route}>Offers</Link>
          <Link href={`/areas/${hub.territory.slug}/saved` as Route}>Saved</Link>
        </nav>
      </header>
      <section className="public-hero public-hero-compact">
        <div>
          <p className="public-kicker">Parent account</p>
          <h1>{hub.authenticated ? `Welcome back, ${hub.contact?.name}` : "Save your local family favourites"}</h1>
          <p>{hub.authenticated ? "Your followed areas, preferences and saved Raring2go content." : hub.emptyState}</p>
          {!hub.authenticated ? (
            <Link
              href={`/sign-in?returnTo=${encodeURIComponent(`/areas/${hub.territory.slug}/saved`)}` as Route}
              className="public-button"
            >
              Sign in to My Raring2go
            </Link>
          ) : null}
        </div>
      </section>
      <section className="public-section">
        <div className="public-section-heading">
          <p className="public-kicker">Followed areas</p>
          <h2>{hub.followedTerritories.length || "No"} followed areas</h2>
        </div>
        <div className="public-card-grid">
          {hub.followedTerritories.map((territory) => (
            <Link key={territory.id} href={`/areas/${territory.slug}` as Route} className="public-card">
              <span>Local area</span>
              <h3>{territory.name}</h3>
              <p>Open your local Raring2go area.</p>
            </Link>
          ))}
          {!hub.authenticated ? <p className="public-empty">{hub.emptyState}</p> : null}
        </div>
      </section>
      <section className="public-section">
        <div className="public-section-heading">
          <p className="public-kicker">Saved</p>
          <h2>{hub.savedContent.length || "No"} saved items</h2>
        </div>
        <div className="public-card-grid">
          {hub.savedContent.map((item) => (
            <Link key={item.id} href={item.href as Route} className="public-card">
              <span>{item.contentType}</span>
              <h3>{item.title}</h3>
              <p>Saved {item.savedAt.slice(0, 10)}</p>
            </Link>
          ))}
          {hub.authenticated && hub.emptyState ? <p className="public-empty">{hub.emptyState}</p> : null}
        </div>
      </section>
      {hub.preferences ? (
        <section className="public-band">
          <div>
            <p className="public-kicker">Preferences</p>
            <h2>{hub.preferences.personalisationEnabled ? "Personalised local discovery is on" : "Personalisation is off"}</h2>
            <p>{[...hub.preferences.interests, ...hub.preferences.eventCategories].join(", ") || "No preferences selected yet."}</p>
          </div>
          <span>{hub.preferences.newsletterFrequency}</span>
        </section>
      ) : null}
    </main>
  );
}
