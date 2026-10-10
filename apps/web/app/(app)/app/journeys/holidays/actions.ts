"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { HolidayCalendarError } from "@raring2go/marketing";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { addHolidayPeriod, removeHolidayPeriod } from "../../../../../lib/holiday-calendar-runtime";

async function actor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "marketing.calendar", action: "manage" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

function back(request: RequestedShellContext, result: string): never {
  revalidatePath("/app/journeys/holidays");
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/journeys/holidays?${query.toString()}` as Route);
}

export async function addHolidayAction(request: RequestedShellContext, formData: FormData) {
  const who = await actor(request);
  const text = (name: string) => String(formData.get(name) ?? "");
  try {
    await addHolidayPeriod(who, { name: text("name"), startsOn: text("startsOn"), endsOn: text("endsOn"), territoryId: text("territoryId") || null });
  } catch (error) {
    if (error instanceof HolidayCalendarError) back(request, error.code);
    throw error;
  }
  back(request, "added");
}

export async function removeHolidayAction(request: RequestedShellContext, periodId: string) {
  const who = await actor(request);
  try {
    await removeHolidayPeriod(who, periodId);
  } catch (error) {
    if (error instanceof HolidayCalendarError) back(request, error.code);
    throw error;
  }
  back(request, "removed");
}
