import { requestSignInAction } from "./actions";
import { safeReturnTo } from "../../lib/auth-runtime";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignInPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const returnTo = safeReturnTo(first(params.returnTo));
  const sent = first(params.sent) === "1";
  const error = first(params.error);

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
        {error === "rate-limited" ? (
          <div className="auth-note" role="alert">
            <p>Too many sign-in attempts. Please wait a while and try again.</p>
          </div>
        ) : null}
        {error === "invalid-link" ? (
          <div className="auth-note" role="alert">
            <p>That sign-in link is invalid or has expired. Request a new one.</p>
          </div>
        ) : null}
        {sent ? (
          <div className="auth-note" role="status">
            <p>Sign-in link requested.</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
