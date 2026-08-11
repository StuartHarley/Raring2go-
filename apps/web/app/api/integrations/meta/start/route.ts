import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionCookieName } from "../../../../../lib/auth-runtime";
import { startMetaConnection } from "../../../../../lib/integrations-runtime";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookieStore = await cookies();
  const redirectUrl = await startMetaConnection({
    sessionToken: cookieStore.get(sessionCookieName)?.value,
    organisationId: url.searchParams.get("organisationId") ?? undefined,
    territoryId: url.searchParams.get("territoryId") ?? undefined
  }, url.searchParams.get("returnTo"));

  return NextResponse.redirect(redirectUrl);
}
