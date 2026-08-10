import { env } from "../lib/env";

export default function Home() {
  return (
    <main>
      <section className="shell" aria-labelledby="page-title">
        <div className="eyebrow">Foundation</div>
        <h1 id="page-title">{env.NEXT_PUBLIC_APP_NAME}</h1>
        <p>
          The monorepo foundation is ready for focused Raring2go Business-in-a-Box
          delivery tickets.
        </p>
      </section>
    </main>
  );
}
