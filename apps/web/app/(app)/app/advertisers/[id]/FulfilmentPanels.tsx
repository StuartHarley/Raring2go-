import type { Advertiser360 } from "@raring2go/advertising";
import { openArtworkExceptions } from "@raring2go/advertising";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { artworkAction, convertRenewalAction, createProofPackAction, dismissRenewalAction, recordFulfilmentAction } from "../actions";

export type FulfilmentAccess = { artworkManage: boolean; artworkApprove: boolean; fulfilmentManage: boolean; proofCreate: boolean; renewalManage: boolean };

const label = (value: string) => value.replaceAll("_", " ");

/** Staff controls for the production-to-renewal tail of a campaign. Hidden when not permitted; always re-checked on the server. */
export function FulfilmentPanels({ request, view, access }: { request: RequestedShellContext; view: Advertiser360; access: FulfilmentAccess }) {
  const advertiserId = view.advertiser.id;
  const versionsFor = (requirementId: string) => view.artworkVersions.filter((version) => version.artworkRequirementId === requirementId);
  const fulfilmentByItem = new Map(view.campaignFulfilments.map((fulfilment) => [fulfilment.bookingItemId, fulfilment]));
  const packFor = (fulfilmentId: string) => view.proofPacks.find((pack) => pack.fulfilmentId === fulfilmentId);
  const openRenewals = view.renewalPrompts.filter((renewal) => renewal.status === "open");

  return (
    <>
      {view.artworkRequirements.length > 0 ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Production</p>
          <h2>Artwork sign-off</h2>
          <div className="franchise-list">
            {view.artworkRequirements.map((requirement) => {
              const exceptions = openArtworkExceptions(requirement);
              const versions = versionsFor(requirement.id);
              const canIssue = access.artworkManage && versions.length > 0 && ["submitted", "received", "changes_requested"].includes(requirement.status);
              return (
                <div key={requirement.id}>
                  <strong>{label(requirement.sourceType)} - {label(requirement.status)}</strong>
                  <span>{versions.length} version(s) - deadline {requirement.deadline ?? "not set"}</span>
                  {exceptions.length > 0 ? <span role="alert">Production exception: preflight failed. A new version must pass before sign-off.</span> : null}
                  {canIssue ? <form action={artworkAction.bind(null, request, advertiserId, requirement.id, "issue_proof")}><button type="submit">Issue proof to advertiser</button></form> : null}
                  {access.artworkManage && ["submitted", "received", "in_review"].includes(requirement.status) ? (
                    <form action={artworkAction.bind(null, request, advertiserId, requirement.id, "request_changes")}><button type="submit">Request changes</button></form>
                  ) : null}
                  {access.artworkApprove && ["submitted", "received", "in_review"].includes(requirement.status) && versions.length > 0 ? (
                    <form action={artworkAction.bind(null, request, advertiserId, requirement.id, "approve_for_advertiser")}>
                      <button type="submit">Record advertiser approval</button>
                      <small>Use when they approved by phone or email.</small>
                    </form>
                  ) : null}
                  {access.artworkApprove && requirement.status === "approved" ? (
                    <form action={artworkAction.bind(null, request, advertiserId, requirement.id, "production_ready")}>
                      <button type="submit">Sign off for production</button>
                      <small>Needs a passing version and, for a page, a page marked ready in Edition Factory.</small>
                    </form>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {access.fulfilmentManage && view.bookings.length > 0 ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Delivery</p>
          <h2>Campaign fulfilment</h2>
          <div className="franchise-list">
            {view.artworkRequirements.map((requirement) => {
              const fulfilment = fulfilmentByItem.get(requirement.bookingItemId);
              const pack = fulfilment ? packFor(fulfilment.id) : undefined;
              return (
                <div key={requirement.bookingItemId}>
                  <strong>{fulfilment ? `${label(fulfilment.status)}${fulfilment.fulfilledOn ? ` on ${fulfilment.fulfilledOn}` : ""}` : "Not scheduled yet"}</strong>
                  <span>{fulfilment?.placementReference && "publishedOutputId" in fulfilment.placementReference ? "Linked to a published edition output" : "No published output linked"}</span>
                  {fulfilment?.status !== "fulfilled" ? (
                    <form action={recordFulfilmentAction.bind(null, request, advertiserId, requirement.bookingItemId)} className="franchise-form">
                      <label>
                        Status
                        <select name="status" defaultValue={fulfilment?.status ?? "scheduled"}>
                          <option value="scheduled">Scheduled</option>
                          <option value="in_progress">In progress</option>
                          <option value="fulfilled">Fulfilled (edition published)</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </label>
                      <label>Scheduled for<input name="scheduledOn" type="date" defaultValue={fulfilment?.scheduledOn ?? ""} /></label>
                      <button type="submit">Save</button>
                    </form>
                  ) : null}
                  {access.proofCreate && fulfilment?.status === "fulfilled" && !pack ? (
                    <form action={createProofPackAction.bind(null, request, advertiserId, fulfilment.id)} className="franchise-form">
                      <label><input type="checkbox" name="deliver" /> Mark as delivered to the advertiser</label>
                      <button type="submit">Create proof pack</button>
                    </form>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {access.renewalManage && openRenewals.length > 0 ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Renewals</p>
          <h2>Renewal prompts</h2>
          <div className="franchise-list">
            {openRenewals.map((renewal) => (
              <div key={renewal.id}>
                <strong>Due {renewal.dueOn ?? "not set"} - {String(renewal.renewalSnapshot.priority ?? "normal")} priority</strong>
                <span>Last campaign finished {String(renewal.renewalSnapshot.lastFulfilledOn ?? "recently")}</span>
                <form action={convertRenewalAction.bind(null, request, advertiserId, renewal.id)}><button type="submit">Start a renewal opportunity</button></form>
                <form action={dismissRenewalAction.bind(null, request, advertiserId, renewal.id)} className="franchise-form">
                  <label>Why not?<input name="reason" required maxLength={200} /></label>
                  <button type="submit">Dismiss</button>
                </form>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
