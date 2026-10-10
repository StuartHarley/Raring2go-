import type { Route } from "next";
import { holidayErrorText } from "@raring2go/marketing";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { readHolidayCalendar } from "../../../../../lib/holiday-calendar-runtime";
import { formatCount, formatDate } from "../../../../../lib/format";
import { EmptyState, LinkButton, Notice, PageHeader, Panel, RecordCard, RecordList, type Tone } from "../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../lib/workflow-ui";
import { requestFromSearchParamsAndCookies } from "../../page";
import { addHolidayAction, removeHolidayAction } from "./actions";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "School holiday calendar" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const banners: Record<string, string> = { added: "Holiday added.", removed: "Holiday removed." };

/** Where a holiday sits against today: finished ones are history, one on now is live, the rest are coming up. */
const timingTone: Record<string, Tone> = { finished: "neutral", on_now: "success", upcoming: "info" };

export default async function HolidayCalendarPage({ searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const code = Array.isArray(search.result) ? search.result[0] : search.result;
  const result = await load(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { data } = result;
  const message = code ? banners[code] ?? (holidayErrorText as Record<string, string>)[code] : undefined;
  const isError = Boolean(code && !banners[code]);
  // ISO day strings compare correctly as text; this is only used to place each holiday against today.
  const today = new Date().toISOString().slice(0, 10);
  const timing = (period: { startsOn: string; endsOn: string }) => (period.endsOn < today ? "finished" : period.startsOn <= today ? "on_now" : "upcoming");

  return (
    <>
      <Breadcrumbs items={[{ label: "Journeys", href: "/app/journeys" as Route }, { label: "School holiday calendar" }]} />
      <PageHeader
        eyebrow="Marketing"
        title="School holiday calendar"
        intro="The dates the school-holiday countdown emails run from. A holiday with no area applies to every area; one with an area applies only there. Each subscriber gets one countdown per holiday, a set number of days before it starts, naming the holiday and its dates."
        actions={
          <LinkButton href={"/app/journeys" as Route} variant="secondary">
            Back to journeys
          </LinkButton>
        }
      />

      {message ? <Notice tone={isError ? "error" : "success"}>{message}</Notice> : null}

      <Panel eyebrow="New holiday" title="Add a holiday" id="new">
        <form action={addHolidayAction.bind(null, request)} className="franchise-form">
          <label>
            Name
            <input name="name" required maxLength={80} placeholder="Autumn half term" />
          </label>
          <label>
            First day
            <input name="startsOn" type="date" required />
          </label>
          <label>
            Last day
            <input name="endsOn" type="date" required />
          </label>
          <label>
            Area
            <select name="territoryId" defaultValue="">
              <option value="">Every area</option>
              {data.areas.map((area) => (
                <option key={area.id} value={area.id}>{area.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="r2-button r2-button--primary">
            Add holiday
          </button>
        </form>
      </Panel>

      <Panel eyebrow="Calendar" title="In the calendar" intro={formatCount(data.periods.length, "holiday")} id="holidays">
        {data.periods.length === 0 ? (
          <EmptyState title="No holidays yet">Without any, no countdown emails are sent. Add the next school holiday above.</EmptyState>
        ) : (
          <RecordList>
            {data.periods.map((period) => (
              <RecordCard
                key={period.id}
                title={period.name}
                status={timing(period)}
                tone={timingTone[timing(period)]}
                lines={[`${formatDate(period.startsOn)} to ${formatDate(period.endsOn)} · ${period.areaName}`]}
              >
                <form action={removeHolidayAction.bind(null, request, period.id)}>
                  <button type="submit" className="r2-button r2-button--danger">
                    Remove
                  </button>
                </form>
              </RecordCard>
            ))}
          </RecordList>
        )}
      </Panel>
    </>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, { module: "marketing.calendar", action: "manage" });
    const data = await readHolidayCalendar({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId });
    return { data };
  } catch (error) {
    return { error };
  }
}
