import Link from "next/link";
import type { Route } from "next";
import { holidayErrorText } from "@raring2go/marketing";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readHolidayCalendar } from "../../../../../lib/holiday-calendar-runtime";
import { Breadcrumbs } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { addHolidayAction, removeHolidayAction } from "./actions";

const banners: Record<string, string> = { added: "Holiday added.", removed: "Holiday removed." };

export default async function HolidayCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const code = Array.isArray(search.result) ? search.result[0] : search.result;
  let data;
  try {
    const shell = await requireShellPermission(request, { module: "marketing.calendar", action: "manage" });
    data = await readHolidayCalendar({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId });
  } catch (error) {
    if (error instanceof ShellAccessError) {
      return <main className={`app-outcome app-outcome-${error.kind}`}><section><h1>{error.kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1><p>{error.message}</p></section></main>;
    }
    throw error;
  }
  const message = code ? banners[code] ?? (holidayErrorText as Record<string, string>)[code] : undefined;
  const isError = Boolean(code && !banners[code]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Journeys", href: "/app/journeys" as Route }, { label: "School holiday calendar" }]} />
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Marketing automation</p>
        <h2>School holiday calendar</h2>
        <p>The dates the school-holiday countdown emails run from. A holiday with no area applies to every area; one with an area applies only there. Each subscriber gets one countdown per holiday, a set number of days before it starts, naming the holiday and its dates.</p>
        {message ? <p role={isError ? "alert" : "status"}>{message}</p> : null}
      </section>
      <section className="app-panel franchise-panel">
        <h2>Add a holiday</h2>
        <form action={addHolidayAction.bind(null, request)} className="franchise-form">
          <label>Name<input name="name" required maxLength={80} placeholder="Autumn half term" /></label>
          <label>First day<input name="startsOn" type="date" required /></label>
          <label>Last day<input name="endsOn" type="date" required /></label>
          <label>Area
            <select name="territoryId" defaultValue="">
              <option value="">Every area</option>
              {data.areas.map((area) => (<option key={area.id} value={area.id}>{area.name}</option>))}
            </select>
          </label>
          <button type="submit">Add holiday</button>
        </form>
      </section>
      <section className="app-panel franchise-panel" aria-label="Holidays">
        <h2>In the calendar ({data.periods.length})</h2>
        {data.periods.length === 0 ? <p>No holidays yet. Without any, no countdown emails are sent.</p> : null}
        <div className="franchise-list">
          {data.periods.map((period) => (
            <div key={period.id}>
              <strong>{period.name}</strong>
              <span>{period.startsOn} to {period.endsOn} - {period.areaName}{period.endsOn < today ? " - finished" : period.startsOn <= today ? " - on now" : ""}</span>
              <form action={removeHolidayAction.bind(null, request, period.id)}><button type="submit">Remove</button></form>
            </div>
          ))}
        </div>
      </section>
      <p><Link href={"/app/journeys" as Route}>Back to journeys</Link></p>
    </AppShell>
  );
}
