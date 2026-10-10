import { requireShellPermission } from "../../../../../lib/app-shell";
import { canEditFranchise, readFranchise360 } from "../../../../../lib/franchise-runtime";
import { displayName, formatCount, formatDate, formatDateTime, formatLabel, formatLabels } from "../../../../../lib/format";
import { Actions, EmptyState, FactList, Metrics, PageHeader, Panel, RecordCard, RecordList, StatusBadge } from "../../../../../lib/page-ui";
import type { Tone } from "../../../../../lib/page-ui";
import { Breadcrumbs, RelatedRecords } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { readFranchisePanel } from "../../../../../lib/assistants-franchise";
import { FranchiseAssistantPanel } from "./FranchiseAssistantPanel";
import { DocumentUploadForm } from "./DocumentUploadForm";
import { requestFromSearchParamsAndCookies } from "../../page";
import {
  approveAgreementAction,
  archiveDocumentAction,
  cancelSignatureAction,
  completeNextSignerAction,
  completeSigningAction,
  declineSigningAction,
  ensureComplianceActionsAction,
  generateAgreementAction,
  approveLaunchAction,
  approveOnboardingTaskAction,
  changeOnboardingTargetAction,
  completeOnboardingTaskAction,
  markLaunchedAction,
  raiseOnboardingBlockerAction,
  rejectComplianceAction,
  rejectInsuranceAction,
  resolveComplianceActionAction,
  resolveOnboardingBlockerAction,
  resendSignatureAction,
  sendAgreementForSignatureAction,
  submitComplianceEvidenceAction,
  submitAgreementAction,
  startOnboardingAction,
  updateFranchiseAction,
  upsertInsuranceAction,
  verifyComplianceAction,
  verifyInsuranceAction,
  voidAgreementAction
} from "../actions";
import { getPermissionData } from "../../../../../lib/permission-source";
import { recordOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Franchisee" };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const severityTone: Record<string, Tone> = { critical: "danger", warning: "warning", info: "info" };
const readinessTone: Record<string, Tone> = { not_ready: "danger", at_risk: "warning", ready: "success", approved: "success", launched: "success" };

export default async function Franchisee360Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const resultCode = Array.isArray(search.result) ? search.result[0] : search.result;
  const result = await loadFranchise360(request, id);

  if ("error" in result) {
    return recordOutcome(result.error, request);
  }

  // The session is carried by cookie; these only repeat any explicit context the page was opened with.
  const contextParams = new URLSearchParams();
  if (request.sessionKey) contextParams.set("session", request.sessionKey);
  if (request.organisationId) contextParams.set("organisationId", request.organisationId);
  if (request.territoryId) contextParams.set("territoryId", request.territoryId);
  const uploadQuery = contextParams.size > 0 ? `?${contextParams.toString()}` : "";
  const downloadQuery = contextParams.size > 0 ? `&${contextParams.toString()}` : "";

  const {
    approve,
    cancelSignature,
    completeNextSigner,
    completeSigning,
    declineSigning,
    generate,
    resendSignature,
    sendSignature,
    submit,
    update,
    view,
    voidCurrent,
    canEdit,
    complianceActions,
    onboardingActions,
    documentActions,
    assistant
  } = result;

  const territoryName = displayName(view.territory.name, "Territory not named yet");
  const openActions = view.complianceActions.filter((action) => action.status === "open");
  const firstPolicy = view.insurancePolicies[0];

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Franchisees", href: "/app/franchisees" }, { label: territoryName }]} />
      <PageHeader
        eyebrow="Franchisee"
        title={displayName(view.organisation.name, "Franchise not named yet")}
        intro={`${territoryName} (${view.territory.code}). The agreement, compliance, onboarding, documents and activity for this franchise in one place.`}
      />

      <RelatedRecords
        title="Where this franchise stands"
        records={[
          {
            label: "Agreement",
            title: view.agreement ? formatLabel(view.agreement.status) : "No current agreement",
            description: "Drafting, approval, signing and execution",
            href: "#agreement"
          },
          {
            label: "Compliance",
            title: formatCount(openActions.length, "open action"),
            description: "Required evidence, insurance and Head Office verification",
            href: "#compliance"
          },
          {
            label: "Onboarding",
            title: view.onboarding.programme ? formatLabel(view.onboarding.programme.status) : "Not started",
            description: "Launch milestones, blockers and readiness",
            href: "#onboarding"
          },
          {
            label: "Documents",
            title: formatCount(view.documents.length, "active document"),
            description: "Agreements, certificates and supporting files",
            href: "#documents"
          },
          {
            label: "Territory",
            title: territoryName,
            description: "Where this franchise publishes and sells",
            href: "/app/territory"
          }
        ]}
      />

      {assistant ? <FranchiseAssistantPanel request={request} franchiseId={id} panel={assistant} resultCode={resultCode} /> : null}

      <Panel id="overview" eyebrow="Overview" title="At a glance">
        <Metrics
          items={[
            { label: "Compliance complete", value: `${view.compliance.completeCount} of ${view.compliance.totalCount}`, tone: view.compliance.actionsRequired > 0 ? "warning" : "success" },
            { label: "Open compliance actions", value: openActions.length, tone: openActions.length > 0 ? "danger" : "success" },
            { label: "Launch progress", value: `${view.onboarding.progress}%`, detail: formatLabel(view.onboarding.readiness), tone: readinessTone[view.onboarding.readiness] },
            { label: "Documents", value: view.documents.length, detail: "active in the vault" }
          ]}
        />
        <FactList
          items={[
            { label: "Status", value: <StatusBadge status={view.franchise.status} /> },
            { label: "Lifecycle", value: formatLabel(view.franchise.lifecycleStage) },
            { label: "Owner", value: view.owner?.displayName ?? "Unassigned" },
            { label: "Launch", value: formatDate(view.franchise.launchDate) },
            { label: "Renewal", value: formatDate(view.franchise.renewalDate) },
            { label: "Onboarding", value: formatLabel(view.franchise.onboardingStatus) },
            { label: "Agreement", value: view.agreement ? <StatusBadge status={view.agreement.status} /> : "Not generated" },
            { label: "Signing", value: view.agreement?.signatureRequest ? <StatusBadge status={view.agreement.signatureRequest.status} /> : "Not sent" },
            { label: "Insurance cover ends", value: firstPolicy ? formatDate(firstPolicy.coverEndDate) : "No policy recorded" },
            { label: "Launch target", value: view.onboarding.programme ? formatDate(view.onboarding.programme.targetLaunchDate) : "Not started" }
          ]}
        />
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
            <button type="submit" className="r2-button r2-button--primary">Save overview</button>
          </form>
        ) : (
          <p className="muted">This record is read-only in the current context.</p>
        )}
      </Panel>

      <Panel eyebrow="Contacts" title="Who to contact">
        {view.contacts.length === 0 ? (
          <EmptyState title="No contacts recorded">Contacts are added when the franchise is set up or its owner changes.</EmptyState>
        ) : (
          <RecordList>
            {view.contacts.map((contact) => (
              <RecordCard
                key={contact.id}
                title={contact.user?.displayName ?? contact.name ?? "External contact"}
                lines={[formatLabel(contact.label), contact.user?.email ?? contact.email ?? "No email"]}
              />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel id="agreement" eyebrow="Agreement" title={view.agreement ? view.agreement.template.name : "Franchise agreement"}>
        {view.agreement ? (
          <>
            <FactList
              items={[
                { label: "Status", value: <StatusBadge status={view.agreement.status} /> },
                { label: "Template version", value: view.agreement.version.version },
                { label: "Submitted", value: formatDate(view.agreement.submittedAt, "Not submitted") },
                { label: "Approved", value: formatDate(view.agreement.approvedAt, "Not approved") },
                { label: "Signing", value: view.agreement.signatureRequest ? <StatusBadge status={view.agreement.signatureRequest.status} /> : "Not sent" },
                { label: "Executed", value: formatDate(view.agreement.executedAt, "Not executed") }
              ]}
            />
            {view.agreement.signers.length > 0 ? (
              <ol className="franchise-activity">
                {view.agreement.signers.map((signer) => (
                  <li key={signer.id}>
                    <strong>
                      {signer.signingOrder}. {formatLabel(signer.role)}
                    </strong>
                    <span>
                      {signer.name} · {formatLabel(signer.status)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
            <details>
              <summary>Merge variable snapshot</summary>
              <pre className="code-block">{JSON.stringify(view.agreement.mergeVariables, null, 2)}</pre>
            </details>
            {canEdit ? (
              <Actions>
                <form action={submit}><button type="submit" className="r2-button r2-button--primary">Submit for approval</button></form>
                <form action={approve}><button type="submit" className="r2-button r2-button--secondary">Approve</button></form>
                <form action={sendSignature}><button type="submit" className="r2-button r2-button--secondary">Send for signature</button></form>
                <form action={resendSignature}><button type="submit" className="r2-button r2-button--secondary">Resend</button></form>
                <form action={completeNextSigner}><button type="submit" className="r2-button r2-button--secondary">Complete next signer</button></form>
                <form action={completeSigning}><button type="submit" className="r2-button r2-button--secondary">Complete signing</button></form>
                <form action={declineSigning}><button type="submit" className="r2-button r2-button--danger">Decline</button></form>
                <form action={cancelSignature}><button type="submit" className="r2-button r2-button--danger">Cancel signing</button></form>
                <form action={voidCurrent}><button type="submit" className="r2-button r2-button--danger">Void</button></form>
              </Actions>
            ) : null}
          </>
        ) : (
          <EmptyState
            title="No agreement generated yet"
            action={
              canEdit ? (
                <form action={generate}>
                  <button type="submit" className="r2-button r2-button--primary">Generate agreement draft</button>
                </form>
              ) : undefined
            }
          >
            A draft is generated from the latest approved template version, then submitted, approved and sent for signature.
          </EmptyState>
        )}
      </Panel>

      <Panel id="documents" eyebrow="Documents" title="Document vault">
        {view.documents.length > 0 ? (
          <RecordList>
            {view.documents.map((document) => (
              <RecordCard
                key={document.id}
                title={document.title}
                status={document.status}
                lines={[
                  `${formatLabel(document.category)} · ${formatLabel(document.documentType)}`,
                  `Version ${document.currentVersion?.versionNumber ?? "-"} · ${document.expiryDate ? `expires ${formatDate(document.expiryDate)}` : "no expiry"}`,
                  document.artifact?.providerMetadata && "fileName" in document.artifact.providerMetadata ? String(document.artifact.providerMetadata.fileName) : "No file stored",
                  ...document.versions.map((version) => (
                    <span key={version.id}>
                      Version {version.versionNumber} · uploaded {formatDateTime(version.uploadedAt, "date unknown")} ·{" "}
                      <a href={`/app/franchisees/${id}/documents/${document.id}/download?version=${version.versionNumber}${downloadQuery}`}>Download</a>
                    </span>
                  ))
                ]}
              >
                {canEdit ? (
                  <>
                    <DocumentUploadForm franchiseId={id} documentId={document.id} queryString={uploadQuery} label="Upload a new version" />
                    <Actions>
                      <form action={documentActions[document.id]?.archive}>
                        <button type="submit" className="r2-button r2-button--danger">Archive</button>
                      </form>
                    </Actions>
                  </>
                ) : null}
              </RecordCard>
            ))}
          </RecordList>
        ) : (
          <EmptyState title="No documents yet">Upload the agreement, insurance certificates and any supporting files here.</EmptyState>
        )}
        {canEdit ? <DocumentUploadForm franchiseId={id} queryString={uploadQuery} label="Upload document" /> : null}
      </Panel>

      <Panel id="compliance" eyebrow="Compliance" title="Insurance and requirements">
        <FactList
          items={[
            { label: "Status", value: <StatusBadge status={view.compliance.status} /> },
            { label: "Complete", value: `${view.compliance.completeCount} of ${view.compliance.totalCount}` },
            { label: "Actions required", value: view.compliance.actionsRequired }
          ]}
        />
        {openActions.length === 0 ? (
          <EmptyState title="No open compliance actions" />
        ) : (
          <RecordList>
            {openActions.map((action) => (
              <RecordCard
                key={action.id}
                title={action.title}
                status={action.severity}
                tone={severityTone[action.severity]}
                lines={[
                  `Due ${formatDate(action.dueDate)}`,
                  formatCount(view.complianceReminders.filter((reminder) => reminder.complianceActionId === action.id).length, "reminder sent", "reminders sent")
                ]}
              >
                {canEdit ? (
                  <form action={complianceActions.actions[action.id]?.resolve}>
                    <button type="submit" className="r2-button r2-button--secondary">Resolve action</button>
                  </form>
                ) : null}
              </RecordCard>
            ))}
          </RecordList>
        )}
        {canEdit ? (
          <form action={complianceActions.ensureActions}>
            <button type="submit" className="r2-button r2-button--secondary">Refresh compliance actions</button>
          </form>
        ) : null}
        {view.insurancePolicies.length > 0 ? (
          <RecordList>
            {view.insurancePolicies.map((policy) => (
              <RecordCard
                key={policy.id}
                title={policy.provider}
                status={policy.verificationStatus}
                lines={[`Policy ${policy.policyNumber}`, `${formatLabels(policy.coverTypes)} until ${formatDate(policy.coverEndDate)}`]}
              >
                {canEdit ? (
                  <Actions>
                    <form action={complianceActions.insurance[policy.id]?.verify}>
                      <button type="submit" className="r2-button r2-button--secondary">Verify insurance</button>
                    </form>
                    <form action={complianceActions.insurance[policy.id]?.reject}>
                      <button type="submit" className="r2-button r2-button--danger">Reject insurance</button>
                    </form>
                  </Actions>
                ) : null}
              </RecordCard>
            ))}
          </RecordList>
        ) : null}
        {view.compliance.requirements.length === 0 ? (
          <EmptyState title="No compliance requirements configured" />
        ) : (
          <RecordList>
            {view.compliance.requirements.map((requirement) => (
              <RecordCard
                key={requirement.id}
                title={requirement.name}
                status={requirement.record?.status ?? "missing"}
                tone={requirement.record ? undefined : "danger"}
                lines={[
                  requirement.record?.expiresAt ? `Expires ${formatDate(requirement.record.expiresAt)}` : "No expiry recorded",
                  requirement.evidence?.title ?? "No evidence linked"
                ]}
              >
                {canEdit && requirement.record ? (
                  <Actions>
                    <form action={complianceActions.records[requirement.record.id]?.verify}>
                      <button type="submit" className="r2-button r2-button--secondary">Verify evidence</button>
                    </form>
                    <form action={complianceActions.records[requirement.record.id]?.reject}>
                      <button type="submit" className="r2-button r2-button--danger">Reject evidence</button>
                    </form>
                  </Actions>
                ) : null}
                <form action={complianceActions.requirements[requirement.id]?.submit} className="franchise-form">
                  <input type="hidden" name="recordId" value={requirement.record?.id ?? ""} />
                  <label>
                    Evidence document
                    <select name="evidenceDocumentId" defaultValue={requirement.record?.evidenceDocumentId ?? ""}>
                      <option value="">No document selected</option>
                      {view.documents.map((document) => (
                        <option key={document.id} value={document.id}>{document.title}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Expires
                    <input name="expiresAt" type="date" defaultValue={requirement.record?.expiresAt ?? ""} />
                  </label>
                  <button type="submit" className="r2-button r2-button--primary">Submit evidence</button>
                </form>
              </RecordCard>
            ))}
          </RecordList>
        )}
        {canEdit ? (
          <form action={complianceActions.upsertInsurance} className="franchise-form">
            <input type="hidden" name="policyId" value={firstPolicy?.id ?? ""} />
            <label>
              Provider
              <input name="provider" defaultValue={firstPolicy?.provider ?? "Seed Mutual"} />
            </label>
            <label>
              Policy number
              <input name="policyNumber" defaultValue={firstPolicy?.policyNumber ?? ""} />
            </label>
            <label>
              Cover types
              <input name="coverTypes" defaultValue={firstPolicy?.coverTypes.join(", ") ?? "public_liability"} />
            </label>
            <label>
              Cover starts
              <input name="coverStartDate" type="date" defaultValue={firstPolicy?.coverStartDate ?? ""} />
            </label>
            <label>
              Cover ends
              <input name="coverEndDate" type="date" defaultValue={firstPolicy?.coverEndDate ?? ""} />
            </label>
            <label>
              Evidence
              <select name="evidenceDocumentId" defaultValue={firstPolicy?.evidenceDocumentId ?? ""}>
                <option value="">No document selected</option>
                {view.documents.map((document) => (
                  <option key={document.id} value={document.id}>{document.title}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="r2-button r2-button--primary">Save insurance</button>
          </form>
        ) : null}
      </Panel>

      <Panel id="onboarding" eyebrow="Onboarding" title="Launch plan">
        {view.onboarding.programme ? (
          <>
            <Metrics
              items={[
                { label: "Progress", value: `${view.onboarding.progress}%`, detail: `Target launch ${formatDate(view.onboarding.programme.targetLaunchDate)}` },
                { label: "Overdue tasks", value: view.onboarding.overdueTasks, tone: view.onboarding.overdueTasks > 0 ? "danger" : "success" },
                { label: "Blocked tasks", value: view.onboarding.blockedTasks, tone: view.onboarding.blockedTasks > 0 ? "danger" : "success" }
              ]}
            />
            <FactList
              items={[
                { label: "Readiness", value: <StatusBadge status={view.onboarding.readiness} tone={readinessTone[view.onboarding.readiness]} /> },
                { label: "Programme", value: <StatusBadge status={view.onboarding.programme.status} /> },
                { label: "Current phase", value: view.onboarding.currentPhase ?? "Complete" }
              ]}
            />
            {canEdit ? (
              <>
                <form action={onboardingActions.changeTarget} className="franchise-form">
                  <label>
                    Target launch
                    <input name="targetLaunchDate" type="date" defaultValue={view.onboarding.programme.targetLaunchDate} />
                  </label>
                  <button type="submit" className="r2-button r2-button--secondary">Update target</button>
                </form>
                <Actions>
                  <form action={onboardingActions.approveLaunch}><button type="submit" className="r2-button r2-button--primary">Approve launch</button></form>
                  <form action={onboardingActions.markLaunched}><button type="submit" className="r2-button r2-button--secondary">Mark launched</button></form>
                </Actions>
              </>
            ) : null}
            {view.onboarding.tasks.length === 0 ? (
              <EmptyState title="No launch tasks yet" />
            ) : (
              <RecordList>
                {view.onboarding.tasks.map((task) => (
                  <RecordCard
                    key={task.id}
                    title={`${task.phaseName}: ${task.title}`}
                    status={task.status}
                    lines={[
                      `Owner: ${formatLabel(task.ownerType)}`,
                      task.dueDate ? `Due ${formatDate(task.dueDate)}` : "No due date",
                      task.status === "blocked" ? "Blocked by a dependency" : null
                    ]}
                  >
                    <Actions>
                      <form action={onboardingActions.tasks[task.id]?.complete}>
                        <button type="submit" className="r2-button r2-button--primary">Complete</button>
                      </form>
                      {canEdit ? (
                        <form action={onboardingActions.tasks[task.id]?.approve}>
                          <button type="submit" className="r2-button r2-button--secondary">Approve</button>
                        </form>
                      ) : null}
                    </Actions>
                    {canEdit ? (
                      <form action={onboardingActions.tasks[task.id]?.raiseBlocker} className="franchise-form">
                        <label>
                          Blocker
                          <input name="title" defaultValue="Needs attention" />
                        </label>
                        <label>
                          Notes
                          <input name="notes" />
                        </label>
                        <button type="submit" className="r2-button r2-button--secondary">Raise blocker</button>
                      </form>
                    ) : null}
                  </RecordCard>
                ))}
              </RecordList>
            )}
            {view.onboarding.blockers.length > 0 ? (
              <RecordList>
                {view.onboarding.blockers.map((blocker) => (
                  <RecordCard key={blocker.id} title={blocker.title} status={blocker.status} tone={blocker.status === "open" ? "danger" : "success"} lines={[blocker.notes ?? "No notes"]}>
                    {canEdit && blocker.status === "open" ? (
                      <form action={onboardingActions.blockers[blocker.id]?.resolve}>
                        <button type="submit" className="r2-button r2-button--secondary">Resolve blocker</button>
                      </form>
                    ) : null}
                  </RecordCard>
                ))}
              </RecordList>
            ) : null}
          </>
        ) : (
          <EmptyState title="No onboarding programme yet">
            Start a guided launch plan from the executed agreement, or create one by hand with a target launch date.
          </EmptyState>
        )}
        {!view.onboarding.programme && canEdit ? (
          <form action={onboardingActions.start} className="franchise-form">
            <label>
              Target launch
              <input name="targetLaunchDate" type="date" defaultValue="2026-11-01" />
            </label>
            <button type="submit" className="r2-button r2-button--primary">Start onboarding</button>
          </form>
        ) : null}
      </Panel>

      {Object.keys(view.placeholders).map((key) => (
        <Panel key={key} id={key} eyebrow={formatLabel(key)} title={`${formatLabel(key)} is coming later`} intro="This part of the franchise record is planned for a later release." />
      ))}

      <Panel id="activity" eyebrow="Activity" title="Recent activity">
        {view.activity.length > 0 ? (
          <ol className="franchise-activity">
            {view.activity.map((event) => (
              <li key={event.id}>
                <strong>{formatLabel(event.action)}</strong>
                <span>{formatDateTime(event.createdAt)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState title="No activity yet">Changes to this franchise are recorded here as they happen.</EmptyState>
        )}
      </Panel>
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
    // The assistant never stops the page loading.
    const assistant = await readFranchisePanel(context, id).catch(() => undefined);
    const update = updateFranchiseAction.bind(null, context, id);
    const generate = generateAgreementAction.bind(null, context, id);
    const submit = submitAgreementAction.bind(null, context, id);
    const approve = approveAgreementAction.bind(null, context, id);
    const voidCurrent = voidAgreementAction.bind(null, context, id);
    const sendSignature = sendAgreementForSignatureAction.bind(null, context, id);
    const resendSignature = resendSignatureAction.bind(null, context, id);
    const cancelSignature = cancelSignatureAction.bind(null, context, id);
    const completeNextSigner = completeNextSignerAction.bind(null, context, id);
    const completeSigning = completeSigningAction.bind(null, context, id);
    const declineSigning = declineSigningAction.bind(null, context, id);
    const upsertInsurance = upsertInsuranceAction.bind(null, context, id);
    const ensureActions = ensureComplianceActionsAction.bind(null, context, id);
    const onboardingActions = {
      start: startOnboardingAction.bind(null, context, id),
      changeTarget: view.onboarding.programme
        ? changeOnboardingTargetAction.bind(null, context, id, view.onboarding.programme.id)
        : undefined,
      approveLaunch: view.onboarding.programme
        ? approveLaunchAction.bind(null, context, id, view.onboarding.programme.id)
        : undefined,
      markLaunched: view.onboarding.programme
        ? markLaunchedAction.bind(null, context, id, view.onboarding.programme.id)
        : undefined,
      tasks: Object.fromEntries(
        view.onboarding.tasks.map((task) => [
          task.id,
          {
            complete: completeOnboardingTaskAction.bind(null, context, id, task.id),
            approve: approveOnboardingTaskAction.bind(null, context, id, task.id),
            raiseBlocker: raiseOnboardingBlockerAction.bind(null, context, id, task.id)
          }
        ])
      ),
      blockers: Object.fromEntries(
        view.onboarding.blockers.map((blocker) => [
          blocker.id,
          {
            resolve: resolveOnboardingBlockerAction.bind(null, context, id, blocker.id)
          }
        ])
      )
    };
    const documentActions = Object.fromEntries(
      view.documents.map((document) => [
        document.id,
        {
          archive: archiveDocumentAction.bind(null, context, id, document.id)
        }
      ])
    );
    const complianceActions = {
      upsertInsurance,
      insurance: Object.fromEntries(
        view.insurancePolicies.map((policy) => [
          policy.id,
          {
            verify: verifyInsuranceAction.bind(null, context, id, policy.id),
            reject: rejectInsuranceAction.bind(null, context, id, policy.id)
          }
        ])
      ),
      requirements: Object.fromEntries(
        view.compliance.requirements.map((requirement) => [
          requirement.id,
          {
            submit: submitComplianceEvidenceAction.bind(null, context, id, requirement.id)
          }
        ])
      ),
      records: Object.fromEntries(
        view.compliance.requirements
          .flatMap((requirement) => requirement.record ? [requirement.record] : [])
          .map((record) => [
            record.id,
            {
              verify: verifyComplianceAction.bind(null, context, id, record.id),
              reject: rejectComplianceAction.bind(null, context, id, record.id)
            }
          ])
      ),
      actions: Object.fromEntries(
        view.complianceActions.map((action) => [
          action.id,
          {
            resolve: resolveComplianceActionAction.bind(null, context, id, action.id)
          }
        ])
      ),
      ensureActions
    };

    return {
      approve,
      cancelSignature,
      canEdit: canEditFranchise(await getPermissionData(), context),
      assistant,
      completeNextSigner,
      completeSigning,
      declineSigning,
      generate,
      resendSignature,
      sendSignature,
      submit,
      update,
      view,
      voidCurrent,
      complianceActions,
      onboardingActions,
      documentActions
    };
  } catch (error) {
    return { error };
  }
}
