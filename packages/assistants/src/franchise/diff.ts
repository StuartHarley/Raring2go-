/**
 * A reviewer's aid for comparing two versions of an agreement: what text was added, removed or changed. It reports
 * differences in wording and says nothing about whether any of them matters legally.
 */
export type ClauseChange = { path: string; kind: "added" | "removed" | "changed"; before?: string; after?: string };

const MAX_TEXT = 600;

function flatten(value: unknown, path: string, out: Map<string, string>) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${path}[${index}]`, out));
    return;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) flatten(nested, path ? `${path}.${key}` : key, out);
    return;
  }
  out.set(path || "(content)", String(value).replace(/\s+/g, " ").trim());
}

export function diffAgreementContent(before: Record<string, unknown>, after: Record<string, unknown>, limit = 40): { changes: ClauseChange[]; truncated: boolean; total: number } {
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  flatten(before, "", a);
  flatten(after, "", b);

  const changes: ClauseChange[] = [];
  for (const [path, text] of b) {
    if (!a.has(path)) changes.push({ path, kind: "added", after: text.slice(0, MAX_TEXT) });
    else if (a.get(path) !== text) changes.push({ path, kind: "changed", before: a.get(path)!.slice(0, MAX_TEXT), after: text.slice(0, MAX_TEXT) });
  }
  for (const [path, text] of a) if (!b.has(path)) changes.push({ path, kind: "removed", before: text.slice(0, MAX_TEXT) });

  changes.sort((x, y) => x.path.localeCompare(y.path));
  return { changes: changes.slice(0, limit), truncated: changes.length > limit, total: changes.length };
}

export function diffMergeFields(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const a = new Set(before);
  const b = new Set(after);
  return { added: [...b].filter((field) => !a.has(field)).sort(), removed: [...a].filter((field) => !b.has(field)).sort() };
}
