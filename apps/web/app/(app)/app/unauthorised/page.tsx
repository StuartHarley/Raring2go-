export default function UnauthorisedPage() {
  return (
    <main className="app-outcome app-outcome-unauthorised">
      <section>
        <p className="eyebrow">Unauthorised</p>
        <h1>Access denied</h1>
        <p>You are signed in, but this context does not grant that capability.</p>
      </section>
    </main>
  );
}
