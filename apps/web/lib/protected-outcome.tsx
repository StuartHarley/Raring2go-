import Link from "next/link";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { OutcomePanel } from "../app/(app)/OutcomePanel";
import { ShellAccessError } from "./app-shell";
import type { ShellOutcome } from "./app-shell";
import { safeReturnTo } from "./auth-runtime";

type Denied = ShellAccessError | Exclude<ShellOutcome, { kind: "authenticated" }>;

/**
 * What a page shows when the server refused it. Someone without a session goes to sign in and
 * comes back afterwards; someone signed in but not allowed sees the refusal inside the shell the
 * layout already rendered, with their navigation and context switcher still there.
 */
export function ProtectedOutcome({ outcome }: { outcome: Denied }) {
  if (outcome.kind === "unauthenticated") {
    redirect(`/sign-in?returnTo=${encodeURIComponent(safeReturnTo("/app"))}` as Route);
  }

  const invalidContext = outcome.kind === "invalid_context";

  return (
    <section className="app-panel app-panel--outcome">
      <OutcomePanel
        eyebrow={invalidContext ? "Context unavailable" : "Access denied"}
        title={invalidContext ? "That context isn't available to you" : "You don't have access to this area"}
        message={
          invalidContext
            ? "The organisation or territory in this link isn't one you belong to. Pick one of your own contexts to carry on."
            : "Your role in the current context doesn't include this area. Switch context from the top bar, or ask your Head Office administrator for access."
        }
        detail={outcome.message}
        actions={
          <>
            <Link href={"/app" as Route} className="r2-button r2-button--primary">
              Go to My Today
            </Link>
            <Link href={"/app/search" as Route} className="r2-button r2-button--secondary">
              Search records
            </Link>
          </>
        }
      />
    </section>
  );
}

export function protectedOutcome(error: unknown) {
  if (error instanceof ShellAccessError) {
    return <ProtectedOutcome outcome={error} />;
  }

  throw error;
}

/**
 * For record pages (one advertiser, one journey, one import): an access refusal renders in the
 * shell as usual, and any other failure to load the record is treated as "not found" so the
 * person gets the branded not-found page rather than a bare message.
 */
export function recordOutcome(error: unknown) {
  if (error instanceof ShellAccessError) {
    return <ProtectedOutcome outcome={error} />;
  }

  notFound();
}
