import { AppShell } from "../../layout";
import { resolveShell } from "../../../../lib/app-shell";
import { buildMyToday } from "../../../../lib/my-today";
import { requestFromSearchParamsAndCookies } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ActionCentrePage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const shell = await resolveShell(request);

  if (shell.kind !== "authenticated") {
    return (
      <main className={`app-outcome app-outcome-${shell.kind}`}>
        <section>
          <p className="eyebrow">{shell.kind.replace("_", " ")}</p>
          <h1>{shell.kind === "unauthenticated" ? "Sign in required" : shell.title}</h1>
          <p>{shell.message}</p>
        </section>
      </main>
    );
  }

  const today = await buildMyToday(shell);
  const grouped = ["critical", "warning", "info"].map((priority) => ({
    priority,
    items: today.attention.filter((item) => item.priority === priority)
  }));

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Action Centre</p>
        <h2>Assignments, exceptions and approvals</h2>
        <p>
          Consolidated operational actions from the modules visible in the active
          organisation and territory context.
        </p>
      </section>

      <section className="app-panel action-centre">
        {grouped.map((group) => (
          <article key={group.priority}>
            <h3>{group.priority}</h3>
            <div className="today-list">
              {group.items.length === 0 ? (
                <p className="empty-state">No {group.priority} actions.</p>
              ) : (
                group.items.map((item) => (
                  <a key={item.id} href={item.href} className={`today-item today-item-${item.priority}`}>
                    <span>{item.area}</span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </a>
                ))
              )}
            </div>
          </article>
        ))}
      </section>
    </AppShell>
  );
}
