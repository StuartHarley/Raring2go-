/** Reads the editor's rows. Anything the form says about ids, sponsored labels or seasonal treatment is ignored: `validateHomepageSlots` owns those. */
export function slotsFromForm(formData: FormData, kinds: string[]) {
  const text = (name: string) => String(formData.get(name) ?? "");
  return kinds
    .map((kind, index) => ({ kind, order: Number(text(`pos-${kind}`)) || index + 1, index }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ kind }) => ({ kind, heading: text(`heading-${kind}`), visible: formData.get(`show-${kind}`) === "on", itemCount: Number(text(`count-${kind}`)), source: text(`source-${kind}`) }));
}

