import Link from "next/link";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "../app/(app)/layout";
import { BrandMark } from "../app/(app)/BrandMark";
import { OutcomePanel } from "../app/(app)/OutcomePanel";
import { ShellAccessError, resolveShell } from "./app-shell";
import type { RequestedShellContext, ShellOutcome } from "./app-shell";
import { safeReturnTo } from "./auth-runtime";

type Denied = ShellAccessError | Exclude<ShellOutcome, { kind: "authenticated" }>;

/**
 * What a page shows when the server refused it. Someone without a session goes to sign in and
 * comes back afterwards; someone signed in but not allowed stays inside the shell, with their
 * navigation and context switcher, so a refusal is never a dead end.
 */
export async function ProtectedOutcome({ outcome, request }: { outcome: Denied; request?: RequestedShellContext }) {
  if (outcome.kind === "unauthenticated") {
    redirect(`/sign-in?returnTo=${encodeURIComponent(safeReturnTo("/app"))}` as Route);
  }

  const invalidContext = outcome.kind === "invalid_context";
  const panel = (
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
          <Link href={withContext("/app", request)} className="r2-button r2-button--primary">
            Go to My Today
          </Link>
          <Link href={withContext("/app/search", request)} className="r2-button r2-button--secondary">
            Search records
          </Link>
        </>
      }
    />
  );

  if (request) {
    const shell = await resolveShell(request);
    if (shell.kind === "authenticated") {
      return (
        <AppShell request={request} shell={shell}>
          <section className="app-panel app-panel--outcome">{panel}</section>
        </AppShell>
      );
    }
  }

  return (
    <main className={`app-outcome app-outcome-${outcome.kind}`}>
      <section>
        <BrandMark />
        {panel}
      </section>
    </main>
  );
}

export function protectedOutcome(error: unknown, request?: RequestedShellContext) {
  if (error instanceof ShellAccessError) {
    return <ProtectedOutcome outcome={error} request={request} />;
  }

  throw error;
}

/**
 * For record pages (one advertiser, one journey, one import): an access refusal renders in the
 * shell as usual, and any other failure to load the record is treated as "not found" so the
 * person gets the branded not-found page rather than a bare message.
 */
export function recordOutcome(error: unknown, request?: RequestedShellContext) {
  if (error instanceof ShellAccessError) {
    return <ProtectedOutcome outcome={error} request={request} />;
  }

  notFound();
}

function withContext(href: string, request: RequestedShellContext | undefined) {
  const query: Record<string, string> = {};
  if (request?.sessionKey) query.session = request.sessionKey;
  if (request?.organisationId) query.organisationId = request.organisationId;
  if (request?.territoryId) query.territoryId = request.territoryId;
  return { pathname: href, query };
}
