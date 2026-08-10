import { AppShell } from "../layout";
import type { RequestedShellContext } from "../../../lib/app-shell";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AppHome({ searchParams }: PageProps) {
  const request = requestFromSearchParams(await searchParams);

  return (
    <AppShell request={request}>
      <section className="app-panel">
        <p className="eyebrow">My Today</p>
        <h2>Role-aware shell ready</h2>
        <p>
          This placeholder proves authenticated context, capability-driven navigation
          and protected route boundaries before product modules are built.
        </p>
      </section>
    </AppShell>
  );
}

export function requestFromSearchParams(
  params: Record<string, string | string[] | undefined>
): RequestedShellContext {
  return {
    sessionKey: first(params.session),
    organisationId: first(params.organisationId),
    territoryId: first(params.territoryId)
  };
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
