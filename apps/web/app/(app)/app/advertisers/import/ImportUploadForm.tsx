"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Territory = { id: string; name: string };

/** Uploads the file as a dry run. Nothing is added to the advertiser records until the next page's explicit "Import" step. */
export function ImportUploadForm({ territories, defaultTerritoryId, queryString }: { territories: Territory[]; defaultTerritoryId?: string; queryString: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a CSV file to check.");
    if (file.size > 1024 * 1024) return setError("That file is larger than 1 MB. Split it and import in parts.");
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/advertisers/import${queryString}`, { method: "POST", body: data });
      const body = (await response.json().catch(() => ({}))) as { error?: string; id?: string };
      if (!response.ok || !body.id) setError(body.error ?? "The file could not be checked.");
      else router.push(`/app/advertisers/import/${body.id}${queryString}` as never);
    } catch {
      setError("The file could not be checked. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="franchise-form">
      {error ? <p role="alert" className="notice notice--error">{error}</p> : null}
      <label>Territory
        <select name="territoryId" required defaultValue={defaultTerritoryId ?? ""}>
          {territories.map((territory) => <option key={territory.id} value={territory.id}>{territory.name}</option>)}
        </select>
      </label>
      <label>Where did this list come from?
        <input name="source" required maxLength={200} placeholder="Chamber of commerce directory, 2025 fair stallholders" />
      </label>
      <label>CSV file (up to 1 MB, 1,000 rows). Columns: business name (required), contact, email, phone, role, tags, notes.
        <input type="file" name="file" accept=".csv,text/csv" required />
      </label>
      <div className="action-row">
        <button type="submit" className="r2-button r2-button--primary" disabled={pending}>{pending ? "Checking…" : "Check the file (dry run)"}</button>
      </div>
      <small>Checking changes nothing. You review the result first.</small>
    </form>
  );
}
