import { seasonErrorText } from "@raring2go/publishing";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readSeasonPlanner } from "../../../../../lib/edition-runtime";
import { Breadcrumbs } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import Link from "next/link";
import type { Route } from "next";
import { approveMasterAction, createSeasonAction, generateEditionsAction } from "./actions";

const banners: Record<string, string> = {
  season_created: "Season and draft master edition created.",
  master_approved: "Master edition approved. You can now generate territory editions.",
  editions_generated: "Territory editions generated.",
  editions_exist: "Those territories already have an edition for this season.",
  no_territories: "Choose at least one territory."
};

export default async function SeasonPlannerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const code = Array.isArray(search.result) ? search.result[0] : search.result;
  let planner;
  let canApprove = false;
  try {
    const shell = await requireShellPermission(request, { module: "edition", action: "create" });
    planner = await readSeasonPlanner({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId });
    canApprove = await requireShellPermission(request, { module: "edition", action: "approve" }).then(() => true, () => false);
  } catch (error) {
    if (error instanceof ShellAccessError) {
      return <main className={`app-outcome app-outcome-${error.kind}`}><section><h1>{error.kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1><p>{error.message}</p></section></main>;
    }
    throw error;
  }
  const message = code ? banners[code] ?? (seasonErrorText as Record<string, string>)[code] : undefined;
  const isError = Boolean(code && !banners[code] && message);
  const date = (name: string, label: string) => (<label>{label}<input type="date" name={name} /></label>);

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Edition Factory", href: "/app/editions" }, { label: "Seasons and masters" }]} />
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Edition Factory</p>
        <h2>Seasons and master editions</h2>
        <p>One season has one master edition. Approving the master lets you generate a territory edition for each territory; each territory edition then drives that territory&apos;s print and digital magazine.</p>
        {message ? <p role={isError ? "alert" : "status"}>{message}</p> : null}
      </section>
      <section className="app-panel franchise-panel">
        <h2>New season</h2>
        <form action={createSeasonAction.bind(null, request)} className="franchise-form">
          <label>Key<input name="key" required placeholder="autumn-2027" /></label>
          <label>Name<input name="name" required placeholder="Autumn 2027" /></label>
          <label>Year<input name="year" type="number" min={2020} max={2100} required /></label>
          <label>Season<select name="season" defaultValue="autumn"><option>spring</option><option>summer</option><option>autumn</option><option>winter</option></select></label>
          <label>Accent colour<input name="accent" type="color" defaultValue="#c04000" /></label>
          <label>Pages (multiple of 4)<input name="pageCount" type="number" min={8} max={200} step={4} defaultValue={36} required /></label>
          {date("bookingDeadline", "Booking deadline")}
          {date("artworkDeadline", "Artwork deadline")}
          {date("editorialDeadline", "Editorial deadline")}
          {date("proofDeadline", "Proof deadline")}
          {date("printDeadline", "Print deadline")}
          {date("distributionDate", "Distribution date")}
          {date("publicationDate", "Publication date")}
          <button type="submit">Create season</button>
        </form>
      </section>
      {planner.length === 0 ? <section className="app-panel franchise-panel"><p>No seasons yet.</p></section> : null}
      {planner.map(({ season, masters }) => (
        <section key={season.id} className="app-panel franchise-panel" aria-label={season.name}>
          <p className="eyebrow">{season.season} {season.year}</p>
          <h2>{season.name}</h2>
          {masters.map(({ master, editions, missing }) => (
            <div key={master.id} className="franchise-list">
              <div>
                <strong>{master.title}</strong>
                <span>{master.status} - {master.pageCount} pages - version {master.version}</span>
                {master.status === "draft" && canApprove ? <form action={approveMasterAction.bind(null, request, master.id)}><button type="submit">Approve master</button></form> : null}
              </div>
              {editions.map(({ edition, territoryName }) => (
                <div key={edition.id}>
                  <strong><Link href={`/app/editions/${edition.id}` as Route}>{territoryName}</Link></strong>
                  <span>{edition.status} - print {edition.printStatus} - digital {edition.digitalStatus}</span>
                </div>
              ))}
              {master.status === "approved" && missing.length > 0 ? (
                <form action={generateEditionsAction.bind(null, request, master.id)}>
                  <fieldset>
                    <legend>Generate territory editions</legend>
                    {missing.map((territory) => (<label key={territory.id}><input type="checkbox" name="territoryIds" value={territory.id} /> {territory.name}</label>))}
                  </fieldset>
                  <button type="submit">Generate</button>
                </form>
              ) : null}
            </div>
          ))}
        </section>
      ))}
    </AppShell>
  );
}
