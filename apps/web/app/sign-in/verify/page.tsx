import { verifySignInToken } from "../actions";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function VerifySignInPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = first(params.token);

  if (token) {
    await verifySignInToken(token, first(params.returnTo));
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">Sign-in link</p>
        <h1>Invalid sign-in link</h1>
        <p>The sign-in link is missing or no longer valid.</p>
      </section>
    </main>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
