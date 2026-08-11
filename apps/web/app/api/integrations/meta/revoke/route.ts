import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionCookieName } from "../../../../../lib/auth-runtime";
import { disconnectMetaConnection } from "../../../../../lib/integrations-runtime";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connectionId");
  if (!connectionId) {
    return NextResponse.redirect(new URL("/app/settings/connections?error=missing-connection", url.origin));
  }
  const cookieStore = await cookies();
  await disconnectMetaConnection({
    sessionToken: cookieStore.get(sessionCookieName)?.value
  }, connectionId);

  return NextResponse.redirect(new URL("/app/settings/connections?revoked=1", url.origin));
}
