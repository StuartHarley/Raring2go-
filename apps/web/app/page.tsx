import Link from "next/link";
import { defaultPublicTerritorySlug } from "../lib/public-runtime";

export default function Home() {
  return (
    <main className="public-site public-season-autumn">
      <section className="public-hero" aria-labelledby="page-title">
        <div>
          <p className="public-kicker">Raring2go!</p>
          <h1 id="page-title">Local family discovery, powered by the Raring2go network</h1>
          <p>
            Find activities, stories, offers and the latest magazine from your
            local Raring2go area.
          </p>
          <div className="public-actions">
            <Link href={`/areas/${defaultPublicTerritorySlug}`}>Open local area</Link>
            <Link href="/sign-in">Platform sign in</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
