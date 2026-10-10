import type { Advertiser360 } from "@raring2go/advertising";
import { openArtworkExceptions } from "@raring2go/advertising";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { formatCount, formatDate, formatLabel } from "../../../../../lib/format";
import { Notice, Panel, RecordCard, RecordList } from "../../../../../lib/page-ui";
import { artworkAction, convertRenewalAction, createProofPackAction, dismissRenewalAction, recordFulfilmentAction } from "../actions";

export type FulfilmentAccess = { artworkManage: boolean; artworkApprove: boolean; fulfilmentManage: boolean; proofCreate: boolean; renewalManage: boolean };

/** A date held loosely in a renewal snapshot, or a fallback when it is missing or not a date. */
const snapshotDate = (value: unknown, fallback: string) => (typeof value === "string" ? formatDate(value, fallback) : fallback);

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
        <Panel eyebrow="Production" title="Artwork sign-off">
          <RecordList>
            {view.artworkRequirements.map((requirement) => {
              const exceptions = openArtworkExceptions(requirement);
              const versions = versionsFor(requirement.id);
              const canIssue = access.artworkManage && versions.length > 0 && ["submitted", "received", "changes_requested"].includes(requirement.status);
              return (
                <RecordCard
                  key={requirement.id}
                  title={formatLabel(requirement.sourceType)}
                  status={requirement.status}
                  lines={[`${formatCount(versions.length, "version")} · Deadline ${formatDate(requirement.deadline, "not set")}`]}
                >
                  {exceptions.length > 0 ? <Notice tone="error">Production exception: preflight failed. A new version must pass before sign-off.</Notice> : null}
                  {canIssue ? (
                    <form action={artworkAction.bind(null, request, advertiserId, requirement.id, "issue_proof")}>
                      <button type="submit" className="r2-button r2-button--secondary">Issue proof to advertiser</button>
                    </form>
                  ) : null}
                  {access.artworkManage && ["submitted", "received", "in_review"].includes(requirement.status) ? (
                    <form action={artworkAction.bind(null, request, advertiserId, requirement.id, "request_changes")}>
                      <button type="submit" className="r2-button r2-button--secondary">Request changes</button>
                    </form>
                  ) : null}
                  {access.artworkApprove && ["submitted", "received", "in_review"].includes(requirement.status) && versions.length > 0 ? (
                    <form action={artworkAction.bind(null, request, advertiserId, requirement.id, "approve_for_advertiser")}>
                      <button type="submit" className="r2-button r2-button--secondary">Record advertiser approval</button>
                      <small>Use when they approved by phone or email.</small>
                    </form>
                  ) : null}
                  {access.artworkApprove && requirement.status === "approved" ? (
                    <form action={artworkAction.bind(null, request, advertiserId, requirement.id, "production_ready")}>
                      <button type="submit" className="r2-button r2-button--secondary">Sign off for production</button>
                      <small>Needs a passing version and, for a page, a page marked ready in Edition Factory.</small>
                    </form>
                  ) : null}
                </RecordCard>
              );
            })}
          </RecordList>
        </Panel>
      ) : null}

      {access.fulfilmentManage && view.bookings.length > 0 ? (
        <Panel eyebrow="Delivery" title="Campaign fulfilment">
          <RecordList>
            {view.artworkRequirements.map((requirement) => {
              const fulfilment = fulfilmentByItem.get(requirement.bookingItemId);
              const pack = fulfilment ? packFor(fulfilment.id) : undefined;
              return (
                <RecordCard
                  key={requirement.bookingItemId}
                  title={formatLabel(requirement.sourceType)}
                  status={fulfilment?.status}
                  lines={[
                    !fulfilment
                      ? "Not scheduled yet"
                      : fulfilment.fulfilledOn
                        ? `Fulfilled on ${formatDate(fulfilment.fulfilledOn)}`
                        : `Scheduled for ${formatDate(fulfilment.scheduledOn, "a date not set yet")}`,
                    fulfilment?.placementReference && "publishedOutputId" in fulfilment.placementReference ? "Linked to a published edition output" : "No published output linked"
                  ]}
                >
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
                      <button type="submit" className="r2-button r2-button--secondary">Save</button>
                    </form>
                  ) : null}
                  {access.proofCreate && fulfilment?.status === "fulfilled" && !pack ? (
                    <form action={createProofPackAction.bind(null, request, advertiserId, fulfilment.id)} className="franchise-form">
                      <label><input type="checkbox" name="deliver" /> Mark as delivered to the advertiser</label>
                      <button type="submit" className="r2-button r2-button--secondary">Create proof pack</button>
                    </form>
                  ) : null}
                </RecordCard>
              );
            })}
          </RecordList>
        </Panel>
      ) : null}

      {access.renewalManage && openRenewals.length > 0 ? (
        <Panel eyebrow="Renewals" title="Renewal prompts">
          <RecordList>
            {openRenewals.map((renewal) => (
              <RecordCard
                key={renewal.id}
                title={`Due ${formatDate(renewal.dueOn, "date not set")}`}
                status={`${String(renewal.renewalSnapshot.priority ?? "normal")}_priority`}
                lines={[`Last campaign finished ${snapshotDate(renewal.renewalSnapshot.lastFulfilledOn, "recently")}`]}
              >
                <form action={convertRenewalAction.bind(null, request, advertiserId, renewal.id)}>
                  <button type="submit" className="r2-button r2-button--secondary">Start a renewal opportunity</button>
                </form>
                <form action={dismissRenewalAction.bind(null, request, advertiserId, renewal.id)} className="franchise-form">
                  <label>Why not?<input name="reason" required maxLength={200} /></label>
                  <button type="submit" className="r2-button r2-button--secondary">Dismiss</button>
                </form>
              </RecordCard>
            ))}
          </RecordList>
        </Panel>
      ) : null}
    </>
  );
}
