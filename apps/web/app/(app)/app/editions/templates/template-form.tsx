import { pageSizePresets } from "@raring2go/publishing";
import type { TemplateSpecInput } from "@raring2go/publishing";

const ROWS = 10;
const kinds = [["headline", "Headline"], ["copy", "Copy"], ["image", "Image"], ["list", "List"], ["advertiser", "Advertiser slot"]] as const;

/** The structured template editor: page set-up, locked furniture, and a row per zone. Posts to the given server action. */
export function TemplateForm({ action, initial, withIdentity, submitLabel }: { action: (formData: FormData) => Promise<void>; initial?: TemplateSpecInput; withIdentity: boolean; submitLabel: string }) {
  const zones = [...(initial?.zones ?? [])];
  while (zones.length < ROWS) zones.push({ id: "", kind: "" });
  const field = (name: string, label: string, value = "", extra: { type?: string; required?: boolean; placeholder?: string } = {}) => (
    <label>
      {label}
      <input name={name} defaultValue={value} type={extra.type ?? "text"} required={extra.required} placeholder={extra.placeholder} />
    </label>
  );
  return (
    <form action={action} className="franchise-form">
      {withIdentity ? (
        <fieldset>
          <legend>Template</legend>
          {field("key", "Key (lower-case, hyphens)", "", { required: true, placeholder: "autumn-article" })}
          {field("name", "Name", "", { required: true })}
          <label>
            Category
            <select name="category" defaultValue="article">
              {["front_cover", "contents", "article", "events", "advertorial", "competition", "directory", "house_page", "campaign", "full_page_ad", "half_page_ad"].map((value) => (
                <option key={value} value={value}>{value.replaceAll("_", " ")}</option>
              ))}
            </select>
          </label>
        </fieldset>
      ) : null}
      <fieldset>
        <legend>Page</legend>
        <label>
          Size
          <select name="size" defaultValue={initial?.size ?? "a4"}>
            {Object.entries(pageSizePresets).map(([key, size]) => (<option key={key} value={key}>{size.label}</option>))}
            <option value="custom">Custom (mm)</option>
          </select>
        </label>
        {field("customWidth", "Custom width (mm)", initial?.customWidth)}
        {field("customHeight", "Custom height (mm)", initial?.customHeight)}
        {field("bleed", "Bleed (mm)", initial?.bleed ?? "3")}
        {field("marginTop", "Top margin (mm)", initial?.margins?.top ?? "12")}
        {field("marginRight", "Right margin (mm)", initial?.margins?.right ?? "12")}
        {field("marginBottom", "Bottom margin (mm)", initial?.margins?.bottom ?? "14")}
        {field("marginLeft", "Left margin (mm)", initial?.margins?.left ?? "12")}
        <label><input type="checkbox" name="showPageNumber" defaultChecked={initial?.showPageNumber ?? true} /> Page number</label>
        <label><input type="checkbox" name="showIssueDate" defaultChecked={initial?.showIssueDate ?? false} /> Issue date in footer</label>
      </fieldset>
      <fieldset>
        <legend>Locked elements</legend>
        <p className="muted">Brand and production furniture local editors cannot change, one per line (for example Masthead, Season badge).</p>
        <textarea name="lockedElements" rows={3} defaultValue={(initial?.lockedElements ?? []).join("\n")} required />
      </fieldset>
      <fieldset>
        <legend>Zones</legend>
        <p className="muted">Millimetres from the top-left of the trim box. Leave position blank to stack the zone in the live area; fill all four to place it. Limits are optional.</p>
        <table>
          <thead>
            <tr><th>Id</th><th>Type</th><th>x</th><th>y</th><th>Width</th><th>Height</th><th>Max chars</th><th>Max words</th><th>Max items</th><th>Min dpi</th></tr>
          </thead>
          <tbody>
            {zones.slice(0, ROWS).map((zone, index) => (
              <tr key={index}>
                <td><input name={`zoneId${index}`} defaultValue={zone.id} aria-label={`Zone ${index + 1} id`} /></td>
                <td>
                  <select name={`zoneKind${index}`} defaultValue={zone.kind} aria-label={`Zone ${index + 1} type`}>
                    <option value="">-</option>
                    {kinds.map(([value, label]) => (<option key={value} value={value}>{label}</option>))}
                  </select>
                </td>
                {(["x", "y", "width", "height", "maxCharacters", "maxWords", "maxItems", "minDpi"] as const).map((key) => (
                  <td key={key}><input name={`zone${key}${index}`} defaultValue={zone[key] ?? ""} size={5} inputMode="decimal" aria-label={`Zone ${index + 1} ${key}`} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
      <button type="submit">{submitLabel}</button>
    </form>
  );
}

/** Reads the form's flat fields back into the structured input. Validation happens in `buildTemplateSpec`, never here. */
export function templateSpecFromForm(formData: FormData): TemplateSpecInput {
  const text = (name: string) => String(formData.get(name) ?? "");
  const zones = Array.from({ length: ROWS }, (_, index) => ({
    id: text(`zoneId${index}`), kind: text(`zoneKind${index}`),
    x: text(`zonex${index}`), y: text(`zoney${index}`), width: text(`zonewidth${index}`), height: text(`zoneheight${index}`),
    maxCharacters: text(`zonemaxCharacters${index}`), maxWords: text(`zonemaxWords${index}`), maxItems: text(`zonemaxItems${index}`), minDpi: text(`zoneminDpi${index}`)
  }));
  return {
    size: (text("size") || "a4") as TemplateSpecInput["size"],
    customWidth: text("customWidth"), customHeight: text("customHeight"), bleed: text("bleed"),
    margins: { top: text("marginTop"), right: text("marginRight"), bottom: text("marginBottom"), left: text("marginLeft") },
    lockedElements: text("lockedElements").split("\n"),
    zones,
    showPageNumber: formData.get("showPageNumber") === "on",
    showIssueDate: formData.get("showIssueDate") === "on"
  };
}
