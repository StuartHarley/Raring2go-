import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import { PageHeader, Panel, RecordLink, RecordList } from "../../../../lib/page-ui";
import { protectedOutcome } from "../../../../lib/protected-outcome";
import { requestFromSearchParamsAndCookies } from "../page";

export const metadata = { title: "System" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** What each administration area is for, in the words a Head Office administrator would use. */
const PURPOSE: Record<string, string> = {
  roles: "Who can do what: roles, the permissions they carry and the people who hold them.",
  connections: "Email, payments, accounting, e-signature and social providers, and whether each one is healthy.",
  "ai-runs": "Every consequential AI run with its purpose, source records, output and approval state.",
  workflows: "The automations that create tasks, send reminders and chase follow-ups, and a builder for new ones.",
  scorecard: "Franchise health scores across the network and the settings behind them.",
  privacy: "Data-subject requests from parents and advertisers, with their deadlines.",
  jobs: "Background jobs: queues, retries, failures and the ability to re-run them.",
  activity: "The audit trail of who changed what, and when."
};

export default async function SystemPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);

  let shell;
  try {
    shell = await requireShellPermission(request, {
      module: "system",
      action: "administer"
    });
  } catch (error) {
    return protectedOutcome(error);
  }

  const areas = shell.navigation.filter((item) => item.group === "administration" && item.id !== "system");

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Administration"
        intro="The controls behind the platform: access, providers, automation, AI, background work and the audit trail."
      />
      <Panel eyebrow="Areas" title="Where to go">
        <RecordList>
          {areas.map((area) => (
            <RecordLink
              key={area.id}
              href={area.href as Route}
              title={area.label}
              lines={[PURPOSE[area.id] ?? "Open this administration area."]}
            />
          ))}
        </RecordList>
      </Panel>
      <Panel eyebrow="Health" title="Is everything running?">
        <p className="app-panel__intro">
          The live health check covers the database, the job queue and the security configuration. Monitoring reads it
          from the health endpoint; you can open it directly to see the current status of each check.
        </p>
        <p>
          <a href="/api/health" className="r2-button r2-button--secondary">
            Open the health check
          </a>
        </p>
      </Panel>
    </>
  );
}

