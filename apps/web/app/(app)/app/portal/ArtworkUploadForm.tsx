"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ArtworkUploadForm({ requirementId, queryString }: { requirementId: string; queryString: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ error?: string; ok?: string }>({});
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("requirementId", requirementId);
    const file = data.get("file");

    if (!(file instanceof File) || file.size === 0) {
      setState({ error: "Choose a file to send." });
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setState({ error: "That file is over 4MB. Please send a smaller file or ask your account manager." });
      return;
    }

    setPending(true);
    setState({});
    try {
      const response = await fetch(`/api/portal/artwork${queryString}`, { method: "POST", body: data });
      const body = (await response.json().catch(() => ({}))) as { error?: string; versionNumber?: number };
      if (!response.ok) {
        setState({ error: body.error ?? "The file could not be sent." });
      } else {
        setState({ ok: `Version ${body.versionNumber} sent. We will review it and be in touch.` });
        form.reset();
        router.refresh();
      }
    } catch {
      setState({ error: "The file could not be sent. Check your connection and try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="franchise-form">
      {state.error ? <p role="alert" className="notice notice--error">{state.error}</p> : null}
      {state.ok ? <p role="status" className="notice notice--success">{state.ok}</p> : null}
      <label>
        Artwork file (PDF, PNG, JPEG or TIFF, up to 4MB)
        <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,application/pdf,image/png,image/jpeg,image/tiff" required />
      </label>
      <label>
        Note for the team (optional)
        <input name="notes" maxLength={500} />
      </label>
      <div className="franchise-actions">
        <button type="submit" disabled={pending}>{pending ? "Sending…" : "Send artwork"}</button>
      </div>
    </form>
  );
}
