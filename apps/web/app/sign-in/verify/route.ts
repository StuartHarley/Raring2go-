import { randomUUID } from "node:crypto";
import { rateLimitRules } from "@raring2go/security";
import { NextResponse } from "next/server";
import { clientIp, firstRateLimitRefusal } from "../../../lib/rate-limit-runtime";
import { safeReturnTo, sessionCookieName, verifySignIn } from "../../../lib/auth-runtime";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));

  if (!token) {
    return NextResponse.redirect(new URL("/sign-in?error=invalid-link", url));
  }

  // Tokens are high-entropy, so guessing is hopeless, but a cap stops anyone hammering the endpoint.
  if (await firstRateLimitRefusal([{ rule: rateLimitRules.signInVerifyIp, identifier: clientIp(request.headers) }])) {
    return NextResponse.redirect(new URL("/sign-in?error=rate-limited", url));
  }

  try {
    const sessionToken = randomUUID();
    await verifySignIn({
      token,
      sessionToken
    });

    const response = NextResponse.redirect(new URL(returnTo, url));
    response.cookies.set(sessionCookieName, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 30 * 24 * 60 * 60
    });

    return response;
  } catch {
    return NextResponse.redirect(new URL("/sign-in?error=invalid-link", url));
  }
}
