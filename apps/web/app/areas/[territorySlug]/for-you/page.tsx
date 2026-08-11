import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";
import { sessionCookieName } from "../../../../lib/auth-runtime";
import { readSessionBackedRecommendations } from "../../../../lib/parent-runtime";
import { territoryFromSlug } from "../../../../lib/public-runtime";

type PageProps = {
  params: Promise<{ territorySlug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const territory = territoryFromSlug((await params).territorySlug);

  return {
    title: territory ? `For You | Raring2go! ${territory.name}` : "For You | Raring2go!",
    description: "Explainable local Raring2go recommendations from approved public records."
  };
}

export default async function ForYouPage({ params }: PageProps) {
  const cookieStore = await cookies();
  const territorySlug = (await params).territorySlug;
  const recommendations = await readSessionBackedRecommendations(
    territorySlug,
    cookieStore.get(sessionCookieName)?.value
  );

  if (!recommendations) {
    notFound();
  }

  return (
    <main className="public-site public-season-autumn">
      <header className="public-nav">
        <Link href={`/areas/${recommendations.territory.slug}` as Route} className="public-logo">Raring2go!</Link>
        <nav aria-label="Public navigation">
          <Link href={`/areas/${recommendations.territory.slug}/whats-on` as Route}>What&apos;s On</Link>
          <Link href={`/areas/${recommendations.territory.slug}/activities` as Route}>Activities</Link>
          <Link href={`/areas/${recommendations.territory.slug}/offers` as Route}>Offers</Link>
          <Link href={`/areas/${recommendations.territory.slug}/saved` as Route}>Saved</Link>
        </nav>
      </header>
      <section className="public-hero public-hero-compact">
        <div>
          <p className="public-kicker">For you</p>
          <h1>{recommendations.personalised ? "Picked from your local preferences" : "Start with local family favourites"}</h1>
          <p>Every recommendation is drawn from approved public Raring2go records and explains why it appears.</p>
          {!recommendations.personalised ? (
            <Link
              href={`/sign-in?returnTo=${encodeURIComponent(`/areas/${recommendations.territory.slug}/for-you`)}` as Route}
              className="public-button"
            >
              Sign in for My Raring2go
            </Link>
          ) : null}
        </div>
      </section>
      <section className="public-section">
        <div className="public-section-heading">
          <p className="public-kicker">Recommendations</p>
          <h2>{recommendations.recommendations.length || "No"} suggestions</h2>
        </div>
        <div className="public-card-grid">
          {recommendations.emptyState ? <p className="public-empty">{recommendations.emptyState}</p> : null}
          {recommendations.recommendations.map((item) => (
            <Link key={item.id} href={item.href as Route} className="public-card">
              <span>{item.type}</span>
              <h3>{item.title}</h3>
              <p>{item.summary}</p>
              <small>{item.reasons.join(" · ")}</small>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
