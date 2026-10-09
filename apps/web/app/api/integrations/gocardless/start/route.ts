import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionCookieName } from "../../../../../lib/auth-runtime";
import { startGoCardlessConnection, goCardlessConfigured } from "../../../../../lib/payments-runtime";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!goCardlessConfigured()) return NextResponse.redirect(new URL("/app/settings/connections?error=gocardless-not-configured", url.origin));
  const cookieStore = await cookies();
  try {
    const redirectUrl = await startGoCardlessConnection({
      sessionToken: cookieStore.get(sessionCookieName)?.value,
      organisationId: url.searchParams.get("organisationId") ?? undefined,
      territoryId: url.searchParams.get("territoryId") ?? undefined
    }, url.searchParams.get("returnTo"));
    return NextResponse.redirect(redirectUrl);
  } catch {
    return NextResponse.redirect(new URL("/app/settings/connections?error=gocardless-start-failed", url.origin));
  }
}
