"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { Route } from "next";
import { redirect } from "next/navigation";
import {
  requestSignIn,
  safeReturnTo,
  sessionCookieName,
  signOut
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

  const params = new URLSearchParams({
    sent: "1",
    returnTo
  });

  if (process.env.NODE_ENV !== "production") {
    params.set("devToken", token);
  }

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
