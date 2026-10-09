"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Territory = { id: string; name: string };

/** Uploads the file as a dry run. Nothing is added to the audience until the next page's explicit "Import" step. */
export function ImportUploadForm({ territories, defaultTerritoryId, queryString }: { territories: Territory[]; defaultTerritoryId?: string; queryString: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a CSV file to check.");
    if (file.size > 2 * 1024 * 1024) return setError("That file is larger than 2 MB. Split it and import in parts.");

    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/audience/import${queryString}`, { method: "POST", body: data });
      const body = (await response.json().catch(() => ({}))) as { error?: string; id?: string };
      if (!response.ok || !body.id) setError(body.error ?? "The file could not be checked.");
      else router.push(`/app/audience/import/${body.id}${queryString}` as never);
    } catch {
      setError("The file could not be checked. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="franchise-form">
      {error ? <p role="alert" className="notice notice--error">{error}</p> : null}
      <label>
        Territory
        <select name="territoryId" required defaultValue={defaultTerritoryId ?? ""}>
          {territories.map((territory) => <option key={territory.id} value={territory.id}>{territory.name}</option>)}
        </select>
      </label>
      <label>
        Where did this list come from?
        <input name="source" required maxLength={200} placeholder="Autumn fair sign-up sheet, Mailchimp export of 5 Oct" />
      </label>
      <fieldset>
        <legend>How was this list collected?</legend>
        <label>
          <input type="radio" name="basis" value="consent_evidenced" defaultChecked /> People agreed to hear from us, and the file records <strong>when</strong> and <strong>where</strong> (columns consent_date and consent_source).
        </label>
        <label>
          <input type="radio" name="basis" value="no_consent_record" /> I do not have a record of their consent. They will be added to the system but <strong>not emailed</strong> until they confirm themselves.
        </label>
        <small>Rows without a valid, recent consent date and source are always imported as &quot;not emailed&quot;, whichever you choose. Anyone who has unsubscribed or been suppressed is never re-added.</small>
      </fieldset>
      <label>
        CSV file (up to 2 MB, 5,000 rows). Columns: email, first_name, last_name, consent_date, consent_source, tags.
        <input type="file" name="file" accept=".csv,text/csv" required />
      </label>
      <div className="franchise-actions">
        <button type="submit" disabled={pending}>{pending ? "Checking…" : "Check the file (dry run)"}</button>
      </div>
      <small>Checking changes nothing. You review the result first.</small>
    </form>
  );
}
