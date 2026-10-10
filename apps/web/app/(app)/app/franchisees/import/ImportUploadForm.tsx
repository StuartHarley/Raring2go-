"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Uploads the file as a dry run. Nothing is added to the franchise or territory records until the next page's explicit "Import" step. */
export function ImportUploadForm({ queryString }: { queryString: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a CSV file to check.");
    if (file.size > 512 * 1024) return setError("That file is larger than 512 KB. Split it and import in parts.");
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/franchisees/import${queryString}`, { method: "POST", body: data });
      const body = (await response.json().catch(() => ({}))) as { error?: string; id?: string };
      if (!response.ok || !body.id) setError(body.error ?? "The file could not be checked.");
      else router.push(`/app/franchisees/import/${body.id}${queryString}` as never);
    } catch {
      setError("The file could not be checked. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="franchise-form">
      {error ? <p role="alert" className="notice notice--error">{error}</p> : null}
      <label>Where did this list come from?
        <input name="source" required maxLength={200} placeholder="Franchise register export, October 2026" />
      </label>
      <label>CSV file (up to 512 KB, 500 rows). Columns: territory code, territory name and franchise name (all required), then optionally contact, email, phone, launch date, renewal date, stage (trading or onboarding), tags.
        <input type="file" name="file" accept=".csv,text/csv" required />
      </label>
      <div className="franchise-actions">
        <button type="submit" disabled={pending}>{pending ? "Checking…" : "Check the file (dry run)"}</button>
      </div>
      <small>Checking changes nothing. You review the result first.</small>
    </form>
  );
}
