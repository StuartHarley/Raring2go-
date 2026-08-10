import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { AppShell } from "../../layout";
import { requestFromSearchParams } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RolesPage({ searchParams }: PageProps) {
  const request = requestFromSearchParams(await searchParams);

  try {
    await requireShellPermission(request, {
      module: "roles",
      action: "view"
    });
  } catch (error) {
    return protectedOutcome(error);
  }

  return (
    <AppShell request={request}>
      <section className="app-panel">
        <p className="eyebrow">Roles & Permissions</p>
        <h2>Permission administration placeholder</h2>
        <p>
          This route is guarded by capability checks, but the editable role-management
          product screen remains out of scope for IAM-003.
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
