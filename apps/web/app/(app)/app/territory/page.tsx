import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { AppShell } from "../../layout";
import { requestFromSearchParams } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TerritoryPage({ searchParams }: PageProps) {
  const request = requestFromSearchParams(await searchParams);

  try {
    await requireShellPermission(request, {
      module: "territory",
      action: "view"
    });
  } catch (error) {
    return protectedOutcome(error);
  }

  return (
    <AppShell request={request}>
      <section className="app-panel">
        <p className="eyebrow">Territory Dashboard</p>
        <h2>Territory workspace placeholder</h2>
        <p>
          Future local operating views will mount here once their own tickets add
          domain models and permissions.
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
