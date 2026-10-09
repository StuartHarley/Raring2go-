import { AppShell } from "../../layout";
import { resolveShell } from "../../../../lib/app-shell";
import { buildMyToday } from "../../../../lib/my-today";
import { EmptyState, PageHeader, Panel } from "../../../../lib/page-ui";
import { ProtectedOutcome } from "../../../../lib/protected-outcome";
import { requestFromSearchParamsAndCookies } from "../page";

export const metadata = { title: "Action Centre" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const GROUPS = [
  { priority: "critical", title: "Critical", intro: "Blocked or failed work that stops something going out.", tone: "winter" as const },
  { priority: "warning", title: "Needs a decision", intro: "Overdue follow-ups, expiring approvals and editions to watch.", tone: "autumn" as const },
  { priority: "info", title: "Worth knowing", intro: "Gaps and reminders that are not urgent yet.", tone: "summer" as const }
];

export default async function ActionCentrePage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const shell = await resolveShell(request);

  if (shell.kind !== "authenticated") {
    return <ProtectedOutcome outcome={shell} request={request} />;
  }

  const today = await buildMyToday(shell);
  const place = shell.activeContext.territoryName ?? shell.activeContext.organisationName;

  return (
    <AppShell request={request} shell={shell}>
      <PageHeader
        eyebrow="Action Centre"
        title="Everything waiting on you"
        intro={`Exceptions and approvals from every area you can see in ${place}, most urgent first.`}
      />

      {GROUPS.map((group) => {
        const items = today.attention.filter((item) => item.priority === group.priority);
        return (
          <Panel key={group.priority} eyebrow={`${items.length} ${items.length === 1 ? "item" : "items"}`} title={group.title} intro={group.intro} accent={group.tone}>
            <div className="today-list">
              {items.length === 0 ? (
                <EmptyState title={`No ${group.title.toLowerCase()} items`} />
              ) : (
                items.map((item) => (
                  <a key={item.id} href={item.href} className={`today-item today-item-${item.priority}`}>
                    <span>{item.area}</span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </a>
                ))
              )}
            </div>
          </Panel>
        );
      })}
    </AppShell>
  );
}
