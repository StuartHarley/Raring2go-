import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SystemPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);

  try {
    await requireShellPermission(request, {
      module: "system",
      action: "administer"
    });
  } catch (error) {
    return protectedOutcome(error);
  }

  return (
    <AppShell request={request}>
      <section className="app-panel">
        <p className="eyebrow">System</p>
        <h2>System administration placeholder</h2>
        <p>
          System-scope access is represented by permissions, not by hard-coded role
          names in the application shell.
        </p>
      </section>
    </AppShell>
  );
}

function protectedOutcome(error: unknown) {
  if (error instanceof ShellAccessError) {
    return (
      <main className={`app-outcome app-outcome-${error.kind}`}>
        <section>
          <p className="eyebrow">{error.kind.replace("_", " ")}</p>
          <h1>{error.kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1>
          <p>{error.message}</p>
        </section>
      </main>
    );
  }

  throw error;
}
