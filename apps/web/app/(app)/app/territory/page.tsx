import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireShellPermission } from "../../../../lib/app-shell";
import { protectedOutcome } from "../../../../lib/protected-outcome";
import { requestFromSearchParamsAndCookies } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * My Today is the territory view. This route stays for old links and bookmarks: it proves the
 * territory permission as before, then sends the person to My Today in the same context.
 */
export default async function TerritoryPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);

  try {
    await requireShellPermission(request, {
      module: "territory",
      action: "view"
    });
  } catch (error) {
    return protectedOutcome(error, request);
  }

  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const suffix = query.toString();

  redirect(`/app${suffix ? `?${suffix}` : ""}` as Route);
}
