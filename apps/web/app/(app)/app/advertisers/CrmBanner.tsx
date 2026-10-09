import type { CrmResult } from "./actions";

const messages: Record<CrmResult, string> = {
  created: "Created.",
  saved: "Saved.",
  duplicate: "An advertiser with that name already exists.",
  not_allowed: "You do not have access to do that for this advertiser or area.",
  invalid: "That could not be saved. Check the details and try again.",
  below_minimum: "That price is below the minimum allowed for this product.",
  needs_approval: "That discount needs approval from someone who can manage pricing.",
  slot_taken: "That edition slot has already been sold.",
  no_price: "There is no price for that product in this area.",
  exception_open: "Artwork failed its checks. A new version has to pass before it can be signed off.",
  page_not_ready: "The edition page is not ready yet, so the artwork cannot be signed off for production.",
  not_published: "That cannot be marked fulfilled until the edition it is in has been published.",
  artwork_not_ready: "The artwork has to be signed off for production before the campaign can run.",
  step_not_allowed: "That step is not available for this artwork yet.",
  already_done: "That has already been done, or it is not in a state where it can be."
};

/** The banner text is looked up from a fixed set, so nothing in the URL is ever shown. */
export function CrmBanner({ result }: { result?: string }) {
  const message = result && Object.hasOwn(messages, result) ? messages[result as CrmResult] : undefined;
  if (!message) return null;
  return (
    <p className={result === "created" || result === "saved" ? "notice notice--success" : "notice notice--error"} role={result === "created" || result === "saved" ? "status" : "alert"}>
      {message}
    </p>
  );
}
