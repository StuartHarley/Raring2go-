import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildContentSecurityPolicy, newNonce } from "./lib/csp";
import { serialiseWorkingContext, workingContextCookieName, workingContextCookieOptions, workingContextFromParams } from "./lib/working-context";

/** Runs before every page request: gives it a fresh nonce and the matching Content-Security-Policy. */
export function proxy(request: NextRequest) {
  const nonce = newNonce();
  const policy = buildContentSecurityPolicy(nonce, { development: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  // A deep link may name a working context in its query string. The shell layout cannot read the
  // query, so the context is copied into the working-context cookie here: into the request's
  // cookie header for this render, and onto the response so the next click keeps it. The value is
  // only a hint; resolveShell checks it against the person's memberships on every request.
  const { searchParams, pathname } = request.nextUrl;
  const requested = pathname.startsWith("/app") ? workingContextFromParams({ organisationId: searchParams.get("organisationId"), territoryId: searchParams.get("territoryId") }) : {};
  const serialised = serialiseWorkingContext(requested);
  if (serialised) {
    const existing = request.headers.get("cookie");
    const others = (existing ?? "").split(";").map((part) => part.trim()).filter((part) => part && !part.startsWith(`${workingContextCookieName}=`));
    requestHeaders.set("cookie", [...others, `${workingContextCookieName}=${serialised}`].join("; "));
  }
  const sessionKey = searchParams.get("session");
  if (sessionKey && process.env.NODE_ENV !== "production") {
    requestHeaders.set("x-r2-session-key", sessionKey);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  if (serialised) {
    response.cookies.set(workingContextCookieName, serialised, workingContextCookieOptions);
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" }
      ]
    }
  ]
};
