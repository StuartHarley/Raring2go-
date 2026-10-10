"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Actions, Notice } from "../../../../../lib/page-ui";

/** Uploads a real file to the vault: a new document, or (with documentId) a new version of one. */
export function DocumentUploadForm({ franchiseId, documentId, queryString, label }: { franchiseId: string; documentId?: string; queryString: string; label: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ error?: string; ok?: boolean }>({});
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("franchiseId", franchiseId);
    if (documentId) data.set("documentId", documentId);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return setState({ error: "Choose a file to upload." });
    if (file.size > 4 * 1024 * 1024) return setState({ error: "Documents must be 4MB or smaller." });

    setPending(true);
    setState({});
    try {
      const response = await fetch(`/api/franchise/documents${queryString}`, { method: "POST", body: data });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) setState({ error: body.error ?? "The document could not be saved." });
      else {
        setState({ ok: true });
        form.reset();
        router.refresh();
      }
    } catch {
      setState({ error: "The document could not be saved. Check your connection and try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="franchise-form">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="success">Saved.</Notice> : null}
      {documentId ? null : (
        <>
          <label>Title<input name="title" maxLength={160} placeholder="Insurance certificate 2026" /></label>
          <label>
            Category
            <select name="category" defaultValue="company_document">
              <option value="agreement">Agreement</option>
              <option value="insurance_certificate">Insurance certificate</option>
              <option value="company_document">Company document</option>
              <option value="policy_certificate">Policy/certificate</option>
            </select>
          </label>
          <label>Document type<input name="documentType" defaultValue="general" maxLength={80} /></label>
          <label>Expiry date<input name="expiryDate" type="date" /></label>
          <label>Description<input name="description" maxLength={500} /></label>
        </>
      )}
      <label>
        File (PDF, PNG, JPEG or Word .docx, up to 4MB)
        <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.docx,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required />
      </label>
      <Actions>
        <button type="submit" className="r2-button r2-button--primary" disabled={pending}>{pending ? "Uploading and scanning…" : label}</button>
      </Actions>
    </form>
  );
}
