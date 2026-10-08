import type { AiRunRecord } from "@raring2go/ai";
import { assistantMessages } from "./assistants-runtime";

/** Labels AI-prepared content so nobody mistakes a draft for a decision, and shows where it came from. */
export function AiPreparedNote({ run }: { run: Pick<AiRunRecord, "id" | "createdAt" | "providerKey" | "approvalState"> }) {
  return (
    <p className="muted">
      Prepared by AI on {run.createdAt.toLocaleDateString("en-GB")}: a draft to check, not a decision.
      {run.approvalState === "pending" ? " Awaiting review." : ""}
    </p>
  );
}

/** Result banner for an assistant action, looked up by fixed code (never reflected from the URL). */
export function AssistantBanner({ code }: { code: string | undefined }) {
  const banner = code ? assistantMessages[code] : undefined;
  if (!banner) return null;
  return (
    <p role={banner.tone === "error" ? "alert" : "status"} className={`notice notice--${banner.tone}`}>
      {banner.text}
    </p>
  );
}

export const fixabilityLabels: Record<string, string> = {
  auto_safe: "Can be fixed safely on a copy",
  manual: "Needs a person to fix",
  needs_new_artwork: "Needs new artwork"
};
