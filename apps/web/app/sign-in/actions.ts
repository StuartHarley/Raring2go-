"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { createSession, findOrCreateUserByEmail } from "@raring2go/auth";
import {
  appAuditRecorder,
  appAuthRepository,
  requestSignIn,
  safeReturnTo,
  sessionCookieName,
  signOut
} from "../../lib/auth-runtime";

const devSessionTtlMs = 30 * 24 * 60 * 60 * 1000;

export async function requestSignInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? ""));

  if (process.env.NODE_ENV !== "production") {
    // Dev convenience: establish a session directly instead of the one-time
    // verification-token flow used in production. A Server Action's redirect
    // can be dispatched by the client more than once (observed: the redirect
    // target gets fetched twice - once as an internal RSC-style request, once
    // as a real navigation), and a one-time token doesn't tolerate being
    // consumed twice, which is exactly what caused this to intermittently
    // fail. Creating a session has no such single-use constraint.
    const user = await findOrCreateUserByEmail(appAuthRepository, { email });
    const sessionToken = randomUUID();
    await createSession(appAuthRepository, appAuditRecorder, {
      userId: user.id,
      token: sessionToken,
      expiresAt: new Date(Date.now() + devSessionTtlMs)
    });

    const cookieStore = await cookies();
    cookieStore.set(sessionCookieName, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: devSessionTtlMs / 1000
    });

    redirect(returnTo as Route);
  }

  const token = randomUUID();

  await requestSignIn({
    email,
    token,
    returnTo
  });

  const params = new URLSearchParams({
    sent: "1",
    returnTo
  });

  redirect(`/sign-in?${params.toString()}` as Route);
}

export async function signOutAction() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(sessionCookieName)?.value;

  if (sessionToken) {
    await signOut({ sessionToken });
  }

  cookieStore.delete(sessionCookieName);
  redirect("/sign-in" as Route);
}
