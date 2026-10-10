"use client";

import { useRef, useState } from "react";

type Option = { fileId: string; fileName: string; widthPx: number; heightPx: number };

/**
 * Choose an uploaded image for a page zone, or upload a new one. The chosen file id is what is saved; its pixel size
 * comes from the stored file on the server, so what is shown here is only a guide to the print resolution.
 */
export function ImagePicker({ zoneId, editionId, query, options, selected, zoneWidthMm, minDpi, disabled }: { zoneId: string; editionId: string; query: string; options: Option[]; selected: string; zoneWidthMm?: number; minDpi?: number; disabled?: boolean }) {
  const select = useRef<HTMLSelectElement>(null);
  const [list, setList] = useState(options);
  const [value, setValue] = useState(selected);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const dpi = (image: Option) => (zoneWidthMm ? Math.round(image.widthPx / (zoneWidthMm / 25.4)) : null);
  const label = (image: Option) => {
    const resolution = dpi(image);
    return `${image.fileName} (${image.widthPx} x ${image.heightPx}px${resolution ? `, ${resolution}dpi here` : ""}${resolution && minDpi && resolution < minDpi ? " - too low for print" : ""})`;
  };

  async function upload(file: File) {
    setBusy(true);
    setMessage("Uploading...");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(`/api/editions/${editionId}/images${query}`, { method: "POST", body });
      const result = (await response.json()) as Option & { error?: string };
      if (!response.ok) {
        setMessage(result.error ?? "Upload failed.");
        return;
      }
      setList((current) => [result, ...current.filter((image) => image.fileId !== result.fileId)]);
      setValue(result.fileId);
      setMessage("Uploaded.");
      // Let the form's autosave notice the new choice.
      setTimeout(() => select.current?.dispatchEvent(new Event("change", { bubbles: true })), 0);
    } catch {
      setMessage("Upload failed. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label>Image
        <select ref={select} name={`image-file-${zoneId}`} value={value} onChange={(event) => setValue(event.target.value)} disabled={disabled}>
          <option value="">None</option>
          {list.map((image) => (<option key={image.fileId} value={image.fileId}>{label(image)}</option>))}
        </select>
      </label>
      {!disabled ? (
        <label>Upload a new image (PNG, JPEG or WebP, up to 4MB)
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
        </label>
      ) : null}
      <span role="status" className="muted">{message}</span>
    </>
  );
}
