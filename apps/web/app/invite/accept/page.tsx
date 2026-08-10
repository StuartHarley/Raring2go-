import { acceptInvite, safeReturnTo } from "../../../lib/auth-runtime";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function InviteAcceptPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = first(params.token);
  const email = first(params.email);
  const returnTo = safeReturnTo(first(params.returnTo));
  let accepted = false;
  let errorMessage: string | undefined;

  if (token && email) {
    try {
      await acceptInvite({
        token,
        email
      });
      accepted = true;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Invitation is invalid.";
    }
  }

  if (accepted) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <p className="eyebrow">Invitation accepted</p>
          <h1>Your access is ready</h1>
          <p>Sign in with the invited email address to continue.</p>
          <a href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>Continue</a>
        </section>
      </main>
    );
  }

  if (errorMessage) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <p className="eyebrow">Invitation</p>
          <h1>Invitation could not be accepted</h1>
          <p>{errorMessage}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">Invitation</p>
        <h1>Accept invitation</h1>
        <p>The invitation link is missing required information.</p>
      </section>
    </main>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
