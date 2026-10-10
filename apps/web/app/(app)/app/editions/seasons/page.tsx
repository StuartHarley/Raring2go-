import type { Route } from "next";
import { seasonErrorText } from "@raring2go/publishing";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { readSeasonPlanner } from "../../../../../lib/edition-runtime";
import { formatCount, formatLabel } from "../../../../../lib/format";
import { EmptyState, Notice, PageHeader, Panel, RecordCard, RecordLink, RecordList } from "../../../../../lib/page-ui";
import { protectedOutcome } from "../../../../../lib/protected-outcome";
import { Breadcrumbs } from "../../../../../lib/workflow-ui";
import { requestFromSearchParamsAndCookies } from "../../page";
import { approveMasterAction, createSeasonAction, generateEditionsAction } from "./actions";

export const metadata = { title: "Seasons and masters" };

const banners: Record<string, string> = {
  season_created: "Season and draft master edition created.",
  master_approved: "Master edition approved. You can now generate territory editions.",
  editions_generated: "Territory editions generated.",
  editions_exist: "Those territories already have an edition for this season.",
  no_territories: "Choose at least one territory."
};

const seasonNames = ["spring", "summer", "autumn", "winter"] as const;
type SeasonName = (typeof seasonNames)[number];

function seasonAccent(value: string): SeasonName | undefined {
  return (seasonNames as ReadonlyArray<string>).includes(value) ? (value as SeasonName) : undefined;
}

const deadlineFields = [
  ["bookingDeadline", "Booking deadline"],
  ["artworkDeadline", "Artwork deadline"],
  ["editorialDeadline", "Editorial deadline"],
  ["proofDeadline", "Proof deadline"],
  ["printDeadline", "Print deadline"],
  ["distributionDate", "Distribution date"],
  ["publicationDate", "Publication date"]
] as const;

export default async function SeasonPlannerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const code = Array.isArray(search.result) ? search.result[0] : search.result;
  const result = await loadPlanner(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { planner, canApprove } = result;
  const message = code ? banners[code] ?? (seasonErrorText as Record<string, string>)[code] : undefined;
  const isError = Boolean(code && !banners[code] && message);

  return (
    <>
      <Breadcrumbs items={[{ label: "Edition Factory", href: "/app/editions" as Route }, { label: "Seasons and masters" }]} />
      <PageHeader
        eyebrow="Edition Factory"
        title="Seasons and master editions"
        intro="One season has one master edition. Approve the master and you can generate a territory edition for each territory; each of those then drives that territory's print and digital magazine."
      />

      {message ? <Notice tone={isError ? "error" : "success"}>{message}</Notice> : null}

      <Panel eyebrow="Plan" title="New season" intro="Creating a season also creates its draft master edition with the page count and deadlines you set here.">
        <form action={createSeasonAction.bind(null, request)} className="franchise-form">
          <label>
            Key
            <input name="key" required placeholder="autumn-2027" />
          </label>
          <label>
            Name
            <input name="name" required placeholder="Autumn 2027" />
          </label>
          <label>
            Year
            <input name="year" type="number" min={2020} max={2100} required />
          </label>
          <label>
            Season
            <select name="season" defaultValue="autumn">
              {seasonNames.map((season) => (
                <option key={season} value={season}>
                  {formatLabel(season)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Accent colour
            <input name="accent" type="color" defaultValue="#c04000" />
          </label>
          <label>
            Pages (multiple of 4)
            <input name="pageCount" type="number" min={8} max={200} step={4} defaultValue={36} required />
          </label>
          {deadlineFields.map(([name, label]) => (
            <label key={name}>
              {label}
              <input type="date" name={name} />
            </label>
          ))}
          <button type="submit" className="r2-button r2-button--primary">
            Create season
          </button>
        </form>
      </Panel>

      {planner.length === 0 ? (
        <Panel eyebrow="Seasons" title="Planned seasons">
          <EmptyState title="No seasons yet">Create the first season above and its master edition will appear here.</EmptyState>
        </Panel>
      ) : null}

      {planner.map(({ season, masters }) => (
        <Panel key={season.id} accent={seasonAccent(season.season)} eyebrow={`${formatLabel(season.season)} ${season.year}`} title={season.name}>
          {masters.length === 0 ? <EmptyState title="No master edition yet" /> : null}
          {masters.map(({ master, editions, missing }) => (
            <RecordList key={master.id}>
              <RecordCard title={master.title} status={master.status} lines={[`${formatCount(master.pageCount, "page")} · Version ${master.version}`]}>
                {master.status === "draft" && canApprove ? (
                  <form action={approveMasterAction.bind(null, request, master.id)}>
                    <button type="submit" className="r2-button r2-button--primary">
                      Approve master
                    </button>
                  </form>
                ) : null}
              </RecordCard>
              {editions.map(({ edition, territoryName }) => (
                <RecordLink
                  key={edition.id}
                  href={`/app/editions/${edition.id}` as Route}
                  title={territoryName}
                  status={edition.status}
                  lines={[`Print ${formatLabel(edition.printStatus).toLowerCase()} · Digital ${formatLabel(edition.digitalStatus).toLowerCase()}`]}
                />
              ))}
              {master.status === "approved" && missing.length > 0 ? (
                <RecordCard title="Generate territory editions" lines={[`${formatCount(missing.length, "territory", "territories")} without an edition for this season yet.`]}>
                  <form action={generateEditionsAction.bind(null, request, master.id)} className="franchise-form">
                    <fieldset>
                      <legend>Territories</legend>
                      {missing.map((territory) => (
                        <label key={territory.id}>
                          <input type="checkbox" name="territoryIds" value={territory.id} /> {territory.name}
                        </label>
                      ))}
                    </fieldset>
                    <button type="submit" className="r2-button r2-button--primary">
                      Generate
                    </button>
                  </form>
                </RecordCard>
              ) : null}
            </RecordList>
          ))}
        </Panel>
      ))}
    </>
  );
}

async function loadPlanner(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, { module: "edition", action: "create" });
    const planner = await readSeasonPlanner({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId });
    const canApprove = await requireShellPermission(request, { module: "edition", action: "approve" }).then(() => true, () => false);
    return { planner, canApprove };
  } catch (error) {
    return { error };
  }
}
