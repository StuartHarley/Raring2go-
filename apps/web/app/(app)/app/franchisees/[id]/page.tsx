import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { canEditFranchise, readFranchise360 } from "../../../../../lib/franchise-runtime";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import {
  approveAgreementAction,
  addDocumentVersionAction,
  archiveDocumentAction,
  cancelSignatureAction,
  completeNextSignerAction,
  completeSigningAction,
  declineSigningAction,
  generateAgreementAction,
  rejectComplianceAction,
  rejectInsuranceAction,
  resendSignatureAction,
  sendAgreementForSignatureAction,
  submitComplianceEvidenceAction,
  submitAgreementAction,
  updateFranchiseAction,
  upsertInsuranceAction,
  uploadDocumentAction,
  verifyComplianceAction,
  verifyInsuranceAction,
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

  const {
    approve,
    cancelSignature,
    completeNextSigner,
    completeSigning,
    declineSigning,
    uploadDocument,
    generate,
    resendSignature,
    sendSignature,
    submit,
    update,
    view,
    voidCurrent,
    canEdit,
    complianceActions,
    documentActions
  } = result;

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
            <div>
              <dt>Agreement</dt>
              <dd>{view.agreement?.status ?? "Not generated"}</dd>
            </div>
            <div>
              <dt>Signing</dt>
              <dd>{view.agreement?.signatureRequest?.status ?? "Not sent"}</dd>
            </div>
            <div>
              <dt>Documents</dt>
              <dd>{view.documents.length} active</dd>
            </div>
            <div>
              <dt>Insurance</dt>
              <dd>{view.insurancePolicies[0]?.coverEndDate ?? "Missing"}</dd>
            </div>
            <div>
              <dt>Compliance</dt>
              <dd>{view.compliance.completeCount}/{view.compliance.totalCount} complete</dd>
            </div>
            <div>
              <dt>Actions required</dt>
              <dd>{view.compliance.actionsRequired}</dd>
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
                <div>
                  <dt>Signing</dt>
                  <dd>{view.agreement.signatureRequest?.status ?? "Not sent"}</dd>
                </div>
                <div>
                  <dt>Executed</dt>
                  <dd>{view.agreement.executedAt ?? "Not executed"}</dd>
                </div>
              </dl>
              {view.agreement.signers.length > 0 ? (
                <ol className="franchise-activity">
                  {view.agreement.signers.map((signer) => (
                    <li key={signer.id}>
                      <strong>{signer.signingOrder}. {signer.role}</strong>
                      <span>{signer.name} - {signer.status}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
              <details>
                <summary>Merge variable snapshot</summary>
                <pre>{JSON.stringify(view.agreement.mergeVariables, null, 2)}</pre>
              </details>
              {canEdit ? (
                <div className="franchise-actions">
                  <form action={submit}><button type="submit">Submit for approval</button></form>
                  <form action={approve}><button type="submit">Approve</button></form>
                  <form action={sendSignature}><button type="submit">Send for signature</button></form>
                  <form action={resendSignature}><button type="submit">Resend</button></form>
                  <form action={completeNextSigner}><button type="submit">Complete next signer</button></form>
                  <form action={completeSigning}><button type="submit">Complete signing</button></form>
                  <form action={declineSigning}><button type="submit">Decline</button></form>
                  <form action={cancelSignature}><button type="submit">Cancel signing</button></form>
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
        <section id="documents" className="app-panel">
          <p className="eyebrow">Documents</p>
          <h3>Franchise document vault</h3>
          {view.documents.length > 0 ? (
            <div className="franchise-list">
              {view.documents.map((document) => (
                <div key={document.id}>
                  <strong>{document.title}</strong>
                  <span>{document.category} - {document.documentType}</span>
                  <span>
                    Version {document.currentVersion?.versionNumber ?? "-"} -
                    {document.expiryDate ? ` expires ${document.expiryDate}` : " no expiry"}
                  </span>
                  <span>{document.artifact?.storageKey ?? "No artifact reference"}</span>
                  {canEdit ? (
                    <div className="franchise-actions">
                      <form action={documentActions[document.id]?.version}>
                        <button type="submit">Add version</button>
                      </form>
                      <form action={documentActions[document.id]?.archive}>
                        <button type="submit">Archive</button>
                      </form>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="franchise-empty">
              <h3>No documents yet</h3>
              <p>Upload franchise documents, agreement references and supporting files.</p>
            </div>
          )}
          {canEdit ? (
            <form action={uploadDocument} className="franchise-form">
              <label>
                Title
                <input name="title" defaultValue="New franchise document" />
              </label>
              <label>
                Category
                <select name="category" defaultValue="company_document">
                  <option value="agreement">Agreement</option>
                  <option value="insurance_certificate">Insurance certificate</option>
                  <option value="company_document">Company document</option>
                  <option value="policy_certificate">Policy/certificate</option>
                </select>
              </label>
              <label>
                Document type
                <input name="documentType" defaultValue="general" />
              </label>
              <label>
                Expiry date
                <input name="expiryDate" type="date" />
              </label>
              <label>
                Description
                <input name="description" defaultValue="" />
              </label>
              <button type="submit">Upload document reference</button>
            </form>
          ) : null}
        </section>
        <section id="compliance" className="app-panel">
          <p className="eyebrow">Compliance</p>
          <h3>Insurance and requirements</h3>
          <dl className="franchise-facts">
            <div>
              <dt>Status</dt>
              <dd>{view.compliance.status}</dd>
            </div>
            <div>
              <dt>Complete</dt>
              <dd>{view.compliance.completeCount}/{view.compliance.totalCount}</dd>
            </div>
            <div>
              <dt>Actions required</dt>
              <dd>{view.compliance.actionsRequired}</dd>
            </div>
          </dl>
          <div className="franchise-list">
            {view.insurancePolicies.map((policy) => (
              <div key={policy.id}>
                <strong>{policy.provider}</strong>
                <span>{policy.policyNumber} - {policy.verificationStatus}</span>
                <span>{policy.coverTypes.join(", ")} until {policy.coverEndDate}</span>
                {canEdit ? (
                  <div className="franchise-actions">
                    <form action={complianceActions.insurance[policy.id]?.verify}>
                      <button type="submit">Verify insurance</button>
                    </form>
                    <form action={complianceActions.insurance[policy.id]?.reject}>
                      <button type="submit">Reject insurance</button>
                    </form>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="franchise-list">
            {view.compliance.requirements.map((requirement) => (
              <div key={requirement.id}>
                <strong>{requirement.name}</strong>
                <span>{requirement.record?.status ?? "missing"}</span>
                <span>{requirement.record?.expiresAt ? `Expires ${requirement.record.expiresAt}` : "No expiry recorded"}</span>
                <span>{requirement.evidence?.title ?? "No evidence linked"}</span>
                {canEdit && requirement.record ? (
                  <div className="franchise-actions">
                    <form action={complianceActions.records[requirement.record.id]?.verify}>
                      <button type="submit">Verify evidence</button>
                    </form>
                    <form action={complianceActions.records[requirement.record.id]?.reject}>
                      <button type="submit">Reject evidence</button>
                    </form>
                  </div>
                ) : null}
                <form action={complianceActions.requirements[requirement.id]?.submit} className="franchise-form">
                  <input type="hidden" name="recordId" value={requirement.record?.id ?? ""} />
                  <label>
                    Evidence document ID
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
                  <button type="submit">Submit evidence</button>
                </form>
              </div>
            ))}
          </div>
          {canEdit ? (
            <form action={complianceActions.upsertInsurance} className="franchise-form">
              <input type="hidden" name="policyId" value={view.insurancePolicies[0]?.id ?? ""} />
              <label>
                Provider
                <input name="provider" defaultValue={view.insurancePolicies[0]?.provider ?? "Seed Mutual"} />
              </label>
              <label>
                Policy number
                <input name="policyNumber" defaultValue={view.insurancePolicies[0]?.policyNumber ?? ""} />
              </label>
              <label>
                Cover types
                <input name="coverTypes" defaultValue={view.insurancePolicies[0]?.coverTypes.join(", ") ?? "public_liability"} />
              </label>
              <label>
                Cover starts
                <input name="coverStartDate" type="date" defaultValue={view.insurancePolicies[0]?.coverStartDate ?? ""} />
              </label>
              <label>
                Cover ends
                <input name="coverEndDate" type="date" defaultValue={view.insurancePolicies[0]?.coverEndDate ?? ""} />
              </label>
              <label>
                Evidence
                <select name="evidenceDocumentId" defaultValue={view.insurancePolicies[0]?.evidenceDocumentId ?? ""}>
                  <option value="">No document selected</option>
                  {view.documents.map((document) => (
                    <option key={document.id} value={document.id}>{document.title}</option>
                  ))}
                </select>
              </label>
              <button type="submit">Save insurance</button>
            </form>
          ) : null}
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
    const sendSignature = sendAgreementForSignatureAction.bind(null, context, id);
    const resendSignature = resendSignatureAction.bind(null, context, id);
    const cancelSignature = cancelSignatureAction.bind(null, context, id);
    const completeNextSigner = completeNextSignerAction.bind(null, context, id);
    const completeSigning = completeSigningAction.bind(null, context, id);
    const declineSigning = declineSigningAction.bind(null, context, id);
    const uploadDocument = uploadDocumentAction.bind(null, context, id);
    const upsertInsurance = upsertInsuranceAction.bind(null, context, id);
    const documentActions = Object.fromEntries(
      view.documents.map((document) => [
        document.id,
        {
          version: addDocumentVersionAction.bind(null, context, id, document.id),
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
      )
    };

    return {
      approve,
      cancelSignature,
      canEdit: canEditFranchise(context),
      completeNextSigner,
      completeSigning,
      declineSigning,
      uploadDocument,
      generate,
      resendSignature,
      sendSignature,
      submit,
      update,
      view,
      voidCurrent,
      complianceActions,
      documentActions
    };
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
