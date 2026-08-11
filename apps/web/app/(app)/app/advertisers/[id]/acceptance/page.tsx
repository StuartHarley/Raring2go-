import { ShellAccessError, requireShellPermission } from "../../../../../../lib/app-shell";
import { readAdvertiser360 } from "../../../../../../lib/advertising-runtime";
import { AppShell } from "../../../../layout";
import { requestFromSearchParamsAndCookies } from "../../../page";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdvertiserAcceptancePage({ params, searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const { id } = await params;
  const result = await loadAdvertiser(request, id);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Commercial acceptance</p>
        <h2>{result.organisation.name}</h2>
        <p>Provider-neutral proposal acceptance records tied to exact proposal versions and approved terms.</p>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Proposal review</p>
        <h2>Current proposals</h2>
        <div className="franchise-list">
          {result.proposals.map((proposal) => {
            const acceptance = result.acceptances.find((candidate) => candidate.proposalId === proposal.id);

            return (
              <div key={proposal.id}>
                <strong>{proposal.title}</strong>
                <span>{proposal.status} - version {proposal.version} - valid until {proposal.validUntil ?? "not set"}</span>
                <span>{acceptance ? `${acceptance.status} by ${acceptance.method}` : "awaiting response"}</span>
              </div>
            );
          })}
        </div>
      </section>
    </AppShell>
  );
}

async function loadAdvertiser(
  request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>,
  advertiserId: string
) {
  try {
    const shell = await requireShellPermission(request, {
      module: "advertiser.proposal",
      action: "view"
    });
    return await readAdvertiser360(
      {
        userId: shell.userId,
        organisationId: shell.activeContext.organisationId,
        territoryId: shell.activeContext.territoryId
      },
      advertiserId
    );
  } catch (error) {
    return { error };
  }
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
