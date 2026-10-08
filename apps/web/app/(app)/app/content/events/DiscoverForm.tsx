"use client";

import { useActionState } from "react";
import type { DiscoverFormState } from "./actions";

export function DiscoverForm({
  action,
  territories,
  defaultFrom,
  defaultTo
}: {
  action: (previous: DiscoverFormState, formData: FormData) => Promise<DiscoverFormState>;
  territories: Array<{ id: string; name: string }>;
  defaultFrom: string;
  defaultTo: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="franchise-form">
      {state?.error ? <p role="alert" className="notice notice--error">{state.error}</p> : null}
      {state?.summary ? <p role="status" className="notice notice--success">{state.summary}</p> : null}
      <label>
        Territory
        <select name="territoryId" defaultValue={territories[0]?.id}>
          {territories.map((territory) => (
            <option key={territory.id} value={territory.id}>{territory.name}</option>
          ))}
        </select>
      </label>
      <label>
        From
        <input type="date" name="from" defaultValue={defaultFrom} required />
      </label>
      <label>
        To
        <input type="date" name="to" defaultValue={defaultTo} required />
      </label>
      <label>
        Interests (optional, comma separated)
        <input name="interests" placeholder="outdoors, under-fives" />
      </label>
      <label>
        Most suggestions to queue
        <input type="number" name="maxResults" min={1} max={20} defaultValue={10} />
      </label>
      <p className="journey-builder-step-note">
        Suggestions go to the queue below for a person to approve. Past events, events without a source link and duplicates are filtered out automatically.
      </p>
      <div className="franchise-actions">
        <button type="submit" disabled={pending}>{pending ? "Searching…" : "Find events"}</button>
      </div>
    </form>
  );
}
