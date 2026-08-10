import Link from "next/link";
import type { Route } from "next";
import { requestSignInAction } from "./actions";
import { safeReturnTo } from "../../lib/auth-runtime";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignInPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const returnTo = safeReturnTo(first(params.returnTo));
  const sent = first(params.sent) === "1";
  const devToken = first(params.devToken);

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="sign-in-title">
        <p className="eyebrow">Raring2go!</p>
        <h1 id="sign-in-title">Sign in</h1>
        <p>Use your email address to receive a secure sign-in link.</p>
        <form action={requestSignInAction} className="auth-form">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label>
            Email
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <button type="submit">Send sign-in link</button>
        </form>
        {sent ? (
          <div className="auth-note" role="status">
            <p>Sign-in link requested.</p>
            {devToken && process.env.NODE_ENV !== "production" ? (
              <Link
                href={`/sign-in/verify?token=${encodeURIComponent(
                  devToken
                )}&returnTo=${encodeURIComponent(returnTo)}` as Route}
              >
                Open development sign-in link
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
