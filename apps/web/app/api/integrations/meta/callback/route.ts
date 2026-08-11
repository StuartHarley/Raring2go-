import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionCookieName } from "../../../../../lib/auth-runtime";
import { completeMetaConnection } from "../../../../../lib/integrations-runtime";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(new URL(`/app/settings/connections?error=${encodeURIComponent(error)}`, url.origin));
  }

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) {
    return NextResponse.redirect(new URL("/app/settings/connections?error=missing-meta-callback", url.origin));
  }

  try {
    const cookieStore = await cookies();
    const result = await completeMetaConnection({
      request: {
        sessionToken: cookieStore.get(sessionCookieName)?.value
      },
      state,
      code,
      selectedPageId: url.searchParams.get("pageId")
    });

    if (result.kind === "page_selection_required") {
      return NextResponse.redirect(new URL("/app/settings/connections?error=multiple-pages-require-explicit-selection", url.origin));
    }

    return NextResponse.redirect(new URL(result.returnTo, url.origin));
  } catch {
    return NextResponse.redirect(new URL("/app/settings/connections?error=meta-callback-failed", url.origin));
  }
}
