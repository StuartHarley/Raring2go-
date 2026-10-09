import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";
import { parentAgeBands, newsletterFrequencies } from "@raring2go/marketing";
import { sessionCookieName } from "../../../../lib/auth-runtime";
import { readParentAccount } from "../../../../lib/parent-runtime";
import { territoryFromSlug } from "../../../../lib/public-runtime";
import { savePreferencesAction, setEmailOptOutAction, setEmailSubscriptionAction } from "./actions";

type PageProps = {
  params: Promise<{ territorySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ageBandLabels: Record<(typeof parentAgeBands)[number], string> = {
  pregnancy: "Expecting",
  "baby-toddler": "Baby or toddler",
  preschool: "Pre-school",
  primary: "Primary school",
  secondary: "Secondary school",
  teen: "Teenager"
};

const frequencyLabels: Record<(typeof newsletterFrequencies)[number], string> = {
  weekly: "Weekly",
  fortnightly: "Every two weeks",
  monthly: "Monthly",
  school_holidays_only: "School holidays only"
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const territory = territoryFromSlug((await params).territorySlug);
  return { title: territory ? `My preferences | Raring2go! ${territory.name}` : "My preferences | Raring2go!", robots: { index: false } };
}

export default async function ParentPreferencesPage({ params, searchParams }: PageProps) {
  const { territorySlug } = await params;
  const query = await searchParams;
  const territory = territoryFromSlug(territorySlug);
  if (!territory) notFound();

  const account = await readParentAccount((await cookies()).get(sessionCookieName)?.value);
  const saved = query.saved !== undefined;
  const confirmTerritoryId = typeof query.confirm === "string" ? query.confirm : undefined;
  const error = typeof query.error === "string" && query.error !== "1" ? query.error : undefined;

  return (
    <main className="public-site public-season-autumn">
      <header className="public-nav">
        <Link href={`/areas/${territorySlug}` as Route} className="public-logo">Raring2go!</Link>
        <nav aria-label="Public navigation">
          <Link href={`/areas/${territorySlug}/whats-on` as Route}>What&apos;s On</Link>
          <Link href={`/areas/${territorySlug}/saved` as Route}>Saved</Link>
          <Link href={`/areas/${territorySlug}/preferences` as Route}>Preferences</Link>
        </nav>
      </header>

      <section className="public-hero public-hero-compact">
        <div>
          <p className="public-kicker">My Raring2go</p>
          <h1>Your preferences</h1>
          <p>
            You decide what we send you and what we remember. We only ask for broad age ranges, never your children&apos;s names
            or dates of birth.
          </p>
        </div>
      </section>

      {saved ? <p className="public-empty" role="status">Your changes have been saved.</p> : null}
      {error ? <p className="public-empty" role="alert">{error}</p> : null}

      {account && confirmTerritoryId ? (
        <ConfirmSubscription slug={territorySlug} account={account} territoryId={confirmTerritoryId} />
      ) : null}

      {!account ? (
        <section className="public-section">
          <p className="public-empty">Sign in to choose your areas, email preferences and saved items.</p>
          <Link href={`/sign-in?returnTo=${encodeURIComponent(`/areas/${territorySlug}/preferences`)}` as Route} className="public-button">
            Sign in to My Raring2go
          </Link>
        </section>
      ) : (
        <>
          <section className="public-section">
            <div className="public-section-heading">
              <p className="public-kicker">Email</p>
              <h2>Emails to {account.contact.email}</h2>
            </div>
            {account.lockedSuppressions.length > 0 ? (
              <p className="public-empty" role="status">
                We cannot email this address at the moment. Contact us if you think this is a mistake.
              </p>
            ) : null}
            <form action={setEmailOptOutAction.bind(null, territorySlug, !account.emailOptedOut)}>
              <p>
                {account.emailOptedOut
                  ? "You have opted out of all Raring2go emails."
                  : "Choose which areas you hear from below, or stop all emails at any time."}
              </p>
              <button type="submit" className="public-button">
                {account.emailOptedOut ? "Opt back in to emails" : "Stop all Raring2go emails"}
              </button>
            </form>
            <div className="public-card-grid">
              {account.territories.map((area) => (
                <form
                  key={area.id}
                  className="public-card"
                  action={setEmailSubscriptionAction.bind(null, territorySlug, area.id, !area.emailSubscribed)}
                >
                  <span>{area.emailSubscribed ? "Subscribed" : "Not subscribed"}</span>
                  <h3>{area.name}</h3>
                  <button type="submit">{area.emailSubscribed ? "Unsubscribe" : "Email me from this area"}</button>
                </form>
              ))}
            </div>
          </section>

          <section className="public-section">
            <div className="public-section-heading">
              <p className="public-kicker">Personalisation</p>
              <h2>What you would like to see</h2>
            </div>
            <form action={savePreferencesAction.bind(null, territorySlug)} className="public-filters">
              <fieldset>
                <legend>Areas you follow</legend>
                {account.territories.map((area) => (
                  <label key={area.id}>
                    <input type="checkbox" name="followed" value={area.id} defaultChecked={account.preferences.followedTerritoryIds.includes(area.id)} /> {area.name}
                  </label>
                ))}
              </fieldset>
              <label>
                Home area
                <select name="homeTerritoryId" defaultValue={account.preferences.homeTerritoryId ?? ""}>
                  <option value="">Not set</option>
                  {account.territories.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                </select>
              </label>
              <fieldset>
                <legend>Broad age ranges (optional)</legend>
                {parentAgeBands.map((band) => (
                  <label key={band}>
                    <input type="checkbox" name="ageBands" value={band} defaultChecked={account.preferences.childAgeBands.includes(band)} /> {ageBandLabels[band]}
                  </label>
                ))}
              </fieldset>
              <label>
                Interests (comma separated)
                <input name="interests" maxLength={400} defaultValue={account.preferences.interests.join(", ")} placeholder="soft play, crafts, outdoors" />
              </label>
              <label>
                Event types (comma separated)
                <input name="eventCategories" maxLength={400} defaultValue={account.preferences.eventCategories.join(", ")} />
              </label>
              <label>
                Offers you like (comma separated)
                <input name="offerPreferences" maxLength={400} defaultValue={account.preferences.offerPreferences.join(", ")} />
              </label>
              <label>
                Competitions you like (comma separated)
                <input name="competitionPreferences" maxLength={400} defaultValue={account.preferences.competitionPreferences.join(", ")} />
              </label>
              <label>
                How often
                <select name="newsletterFrequency" defaultValue={account.preferences.newsletterFrequency}>
                  {newsletterFrequencies.map((frequency) => <option key={frequency} value={frequency}>{frequencyLabels[frequency]}</option>)}
                </select>
              </label>
              <label>
                <input type="checkbox" name="personalisationEnabled" defaultChecked={account.preferences.personalisationEnabled} /> Tailor what I see to these choices
              </label>
              <button type="submit">Save preferences</button>
            </form>
          </section>
        </>
      )}
    </main>
  );
}

/** The second half of double opt-in: nothing is subscribed until the parent presses this. */
function ConfirmSubscription({ slug, account, territoryId }: { slug: string; account: NonNullable<Awaited<ReturnType<typeof readParentAccount>>>; territoryId: string }) {
  const area = account.territories.find((candidate) => candidate.id === territoryId);
  if (!area || area.emailSubscribed) return null;

  return (
    <section className="public-section" aria-labelledby="confirm-heading">
      <h2 id="confirm-heading">Confirm your {area.name} newsletter</h2>
      <p>We will email {account.contact.email} with local family ideas for {area.name}. You can stop at any time.</p>
      <form action={setEmailSubscriptionAction.bind(null, slug, area.id, true)}>
        <button type="submit" className="public-button">Yes, email me</button>
      </form>
    </section>
  );
}
