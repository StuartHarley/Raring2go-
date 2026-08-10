"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { Route } from "next";
import { redirect } from "next/navigation";
import {
  requestSignIn,
  safeReturnTo,
  sessionCookieName,
  signOut,
  verifySignIn
} from "../../lib/auth-runtime";

export async function requestSignInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? ""));
  const token = randomUUID();

  await requestSignIn({
    email,
    token,
    returnTo
  });

  if (process.env.NODE_ENV !== "production") {
    const sessionToken = randomUUID();
    await verifySignIn({
      token,
      sessionToken
    });

    const cookieStore = await cookies();
    cookieStore.set(sessionCookieName, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 30 * 24 * 60 * 60
    });

    redirect(returnTo as Route);
  }

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
