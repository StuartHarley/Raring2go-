import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { canEditFranchise, readFranchise360 } from "../../../../../lib/franchise-runtime";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import {
  approveAgreementAction,
  generateAgreementAction,
  submitAgreementAction,
  updateFranchiseAction,
  voidAgreementAction
} from "../actions";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Franchisee360Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadFranchise360(request, id);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { approve, generate, submit, update, view, voidCurrent, canEdit } = result;

  return (
    <AppShell request={request}>
      <article className="franchise-360">
        <header className="franchise-hero">
          <p className="eyebrow">Franchisee 360</p>
          <h2>{view.organisation.name}</h2>
          <p>{view.territory.name} ({view.territory.code})</p>
        </header>
        <nav className="franchise-tabs" aria-label="Franchisee 360 sections">
          {[
            "Overview",
            "Performance",
            "Agreement",
            "Compliance",
            "Training",
            "Support",
            "Documents",
            "Activity"
          ].map((label) => (
            <a key={label} href={`#${label.toLowerCase()}`}>
              {label}
            </a>
          ))}
        </nav>
        <section id="overview" className="app-panel">
          <p className="eyebrow">Overview</p>
          <dl className="franchise-facts">
            <div>
              <dt>Status</dt>
              <dd>{view.franchise.status}</dd>
            </div>
            <div>
              <dt>Lifecycle</dt>
              <dd>{view.franchise.lifecycleStage}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{view.owner?.displayName ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt>Launch</dt>
              <dd>{view.franchise.launchDate ?? "Not set"}</dd>
            </div>
            <div>
              <dt>Renewal</dt>
              <dd>{view.franchise.renewalDate ?? "Not set"}</dd>
            </div>
            <div>
              <dt>Onboarding</dt>
              <dd>{view.franchise.onboardingStatus}</dd>
            </div>
          </dl>
          {canEdit ? (
            <form action={update} className="franchise-form">
              <label>
                Lifecycle
                <select name="lifecycleStage" defaultValue={view.franchise.lifecycleStage}>
                  <option value="onboarding">Onboarding</option>
                  <option value="trading">Trading</option>
                  <option value="renewal">Renewal</option>
                  <option value="exit">Exit</option>
                </select>
              </label>
              <label>
                Onboarding
                <input name="onboardingStatus" defaultValue={view.franchise.onboardingStatus} />
              </label>
              <label>
                Support
                <input name="supportStatus" defaultValue={view.franchise.supportStatus} />
              </label>
              <label>
                Renewal date
                <input name="renewalDate" type="date" defaultValue={view.franchise.renewalDate ?? ""} />
              </label>
              <button type="submit">Save overview</button>
            </form>
          ) : (
            <p className="franchise-readonly">This record is read-only in the current context.</p>
          )}
        </section>
        <section className="app-panel">
          <p className="eyebrow">Contacts</p>
          <div className="franchise-list">
            {view.contacts.map((contact) => (
              <div key={contact.id}>
                <strong>{contact.label}</strong>
                <span>{contact.user?.displayName ?? contact.name ?? "External contact"}</span>
                <span>{contact.user?.email ?? contact.email ?? "No email"}</span>
              </div>
            ))}
          </div>
        </section>
        <section id="agreement" className="app-panel">
          <p className="eyebrow">Agreement</p>
          {view.agreement ? (
            <div className="franchise-agreement">
              <h3>{view.agreement.template.name}</h3>
              <dl className="franchise-facts">
                <div>
                  <dt>Status</dt>
                  <dd>{view.agreement.status}</dd>
                </div>
                <div>
                  <dt>Template version</dt>
                  <dd>{view.agreement.version.version}</dd>
                </div>
                <div>
                  <dt>Submitted</dt>
                  <dd>{view.agreement.submittedAt ?? "Not submitted"}</dd>
                </div>
                <div>
                  <dt>Approved</dt>
                  <dd>{view.agreement.approvedAt ?? "Not approved"}</dd>
                </div>
              </dl>
              <details>
                <summary>Merge variable snapshot</summary>
                <pre>{JSON.stringify(view.agreement.mergeVariables, null, 2)}</pre>
              </details>
              {canEdit ? (
                <div className="franchise-actions">
                  <form action={submit}><button type="submit">Submit for approval</button></form>
                  <form action={approve}><button type="submit">Approve</button></form>
                  <form action={voidCurrent}><button type="submit">Void</button></form>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="franchise-empty">
              <h3>No agreement generated yet</h3>
              <p>Generate a controlled agreement draft from the latest approved template version.</p>
              {canEdit ? (
                <form action={generate}>
                  <button type="submit">Generate agreement draft</button>
                </form>
              ) : null}
            </div>
          )}
        </section>
        {Object.entries(view.placeholders).map(([key]) => (
          <section key={key} id={key} className="app-panel">
            <p className="eyebrow">{key}</p>
            <h3>{title(key)} is deferred</h3>
            <p>
              This Franchisee 360 section is reserved for a later ticket and does
              not depend on premature domain tables.
            </p>
          </section>
        ))}
        <section id="activity" className="app-panel">
          <p className="eyebrow">Activity</p>
          {view.activity.length > 0 ? (
            <ol className="franchise-activity">
              {view.activity.map((event) => (
                <li key={event.id}>
                  <strong>{event.action}</strong>
                  <span>{event.createdAt.toISOString()}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p>No audited franchise activity yet.</p>
          )}
        </section>
      </article>
    </AppShell>
  );
}

async function loadFranchise360(
  request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>,
  id: string
) {
  try {
    const shell = await requireShellPermission(request, {
      module: "franchise",
      action: "view"
    });
    const context = {
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    };
    const view = await readFranchise360(context, id);
    const update = updateFranchiseAction.bind(null, context, id);
    const generate = generateAgreementAction.bind(null, context, id);
    const submit = submitAgreementAction.bind(null, context, id);
    const approve = approveAgreementAction.bind(null, context, id);
    const voidCurrent = voidAgreementAction.bind(null, context, id);

    return { approve, canEdit: canEditFranchise(context), generate, submit, update, view, voidCurrent };
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

  return (
    <main className="app-outcome app-outcome-unauthorised">
      <section>
        <p className="eyebrow">Access denied</p>
        <h1>Franchise not available</h1>
        <p>{error instanceof Error ? error.message : "This franchise is not available."}</p>
      </section>
    </main>
  );
}

function title(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
