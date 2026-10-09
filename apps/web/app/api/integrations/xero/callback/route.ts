import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionCookieName } from "../../../../../lib/auth-runtime";
import { completeXeroConnection } from "../../../../../lib/xero-runtime";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Provider-supplied text is never reflected: only fixed codes go back to the page.
  if (url.searchParams.get("error")) return NextResponse.redirect(new URL("/app/settings/connections?error=xero-declined", url.origin));

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) return NextResponse.redirect(new URL("/app/settings/connections?error=missing-xero-callback", url.origin));

  try {
    const cookieStore = await cookies();
    const result = await completeXeroConnection({ request: { sessionToken: cookieStore.get(sessionCookieName)?.value }, state, code });
    return NextResponse.redirect(new URL(result.returnTo, url.origin));
  } catch {
    return NextResponse.redirect(new URL("/app/settings/connections?error=xero-callback-failed", url.origin));
  }
}
