import { ShellAccessError, type ShellOutcome } from "./app-shell";

export function ProtectedOutcome({ outcome }: { outcome: ShellAccessError | Exclude<ShellOutcome, { kind: "authenticated" }> }) {
  const kind = outcome.kind;
  const message = outcome instanceof ShellAccessError ? outcome.message : outcome.message;
  const title =
    kind === "unauthenticated"
      ? "Sign in required"
      : outcome instanceof ShellAccessError
        ? "Access denied"
        : outcome.title;

  return (
    <main className={`app-outcome app-outcome-${kind}`}>
      <section>
        <p className="eyebrow">{kind.replace("_", " ")}</p>
        <h1>{title}</h1>
        <p>{message}</p>
      </section>
    </main>
  );
}

export function protectedOutcome(error: unknown) {
  if (error instanceof ShellAccessError) {
    return <ProtectedOutcome outcome={error} />;
  }

  throw error;
}
