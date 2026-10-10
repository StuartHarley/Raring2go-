"use client";

import { useActionState } from "react";
import type { RepurposeFormState } from "./actions";

const CHANNELS = [
  { value: "website", label: "Website article" },
  { value: "newsletter", label: "Newsletter teaser" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "magazine", label: "Magazine feature" }
];

export function RepurposeForm({ action }: { action: (previous: RepurposeFormState, formData: FormData) => Promise<RepurposeFormState> }) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="franchise-form">
      {state?.error ? <p role="alert" className="notice notice--error">{state.error}</p> : null}
      {state?.summary ? <p role="status" className="notice notice--success">{state.summary}</p> : null}
      <fieldset>
        <legend>Create variants for</legend>
        {CHANNELS.map((channel) => (
          <label key={channel.value}>
            <input type="checkbox" name="channels" value={channel.value} defaultChecked={["website", "newsletter", "facebook"].includes(channel.value)} /> {channel.label}
          </label>
        ))}
      </fieldset>
      <p className="journey-builder-step-note">
        Each variant is written only from this article&apos;s facts and starts as a draft that you review and approve. Anything that looks like a new date, time, price or link is flagged.
      </p>
      <div className="franchise-actions">
        <button type="submit" className="r2-button r2-button--primary" disabled={pending}>{pending ? "Writing…" : "Create variants with AI"}</button>
      </div>
    </form>
  );
}
