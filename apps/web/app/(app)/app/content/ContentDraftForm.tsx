"use client";

import { useActionState } from "react";
import type { DraftFormState } from "./actions";

const CONTENT_TYPES = [
  { value: "article", label: "Article" },
  { value: "guide", label: "Guide" },
  { value: "event", label: "Event" },
  { value: "offer", label: "Offer" },
  { value: "announcement", label: "Announcement" },
  { value: "evergreen", label: "Evergreen" }
];

export function ContentDraftForm({
  action,
  revising,
  defaultType
}: {
  action: (previous: DraftFormState, formData: FormData) => Promise<DraftFormState>;
  revising: boolean;
  defaultType: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="franchise-form">
      {state?.error ? (
        <p role="alert" className="notice notice--error">
          {state.error}
        </p>
      ) : null}
      {revising ? <input type="hidden" name="contentType" value={defaultType} /> : (
        <label>
          Type of content
          <select name="contentType" defaultValue={defaultType}>
            {CONTENT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        {revising ? "What should change?" : "What should it be about?"}
        <textarea
          name="brief"
          rows={6}
          required
          minLength={10}
          maxLength={3000}
          placeholder={revising ? "e.g. Make it warmer, add a tip about parking, shorten the opening." : "e.g. Five free things to do with under-fives in Sutton Coldfield this half term. Mention the library story sessions on Tuesdays."}
        />
      </label>
      <p className="journey-builder-step-note">
        AI writes a first draft only. It will not invent dates, prices, venues or links, and you review it before anything is saved.
      </p>
      <div className="franchise-actions">
        <button type="submit" disabled={pending}>{pending ? "Drafting…" : revising ? "Draft a revision" : "Draft with AI"}</button>
      </div>
    </form>
  );
}
