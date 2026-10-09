import type { CrmResult } from "./actions";

const messages: Record<CrmResult, string> = {
  created: "Created.",
  saved: "Saved.",
  duplicate: "An advertiser with that name already exists.",
  not_allowed: "You do not have access to do that for this advertiser or area.",
  invalid: "That could not be saved. Check the details and try again."
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
