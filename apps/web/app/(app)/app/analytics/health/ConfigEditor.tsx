"use client";

import { useActionState } from "react";
import type { ConfigFormState } from "./actions";

export type EditorFactor = { metric: string; weight: number | ""; bad: number | ""; good: number | "" };
export type MetricOption = { key: string; label: string };

const ROWS = 12;

export function ConfigEditor({
  action,
  metrics,
  factors,
  thresholds,
  changeNote,
  submitLabel
}: {
  action: (state: ConfigFormState, formData: FormData) => Promise<ConfigFormState>;
  metrics: MetricOption[];
  factors: EditorFactor[];
  thresholds: { green: number; amber: number };
  changeNote: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const rows: EditorFactor[] = [...factors, ...Array.from({ length: Math.max(0, ROWS - factors.length) }, () => ({ metric: "", weight: "" as const, bad: "" as const, good: "" as const }))].slice(0, ROWS);

  return (
    <form action={formAction} className="franchise-form">
      {state?.errors?.length ? (
        <div role="alert" className="notice notice--error">
          <ul>
            {state.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Weight</th>
              <th>Scores 0 at</th>
              <th>Scores 100 at</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>
                  <select name={`metric_${index}`} defaultValue={row.metric} aria-label={`Factor ${index + 1} metric`}>
                    <option value="">(unused)</option>
                    {metrics.map((metric) => (
                      <option key={metric.key} value={metric.key}>
                        {metric.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input name={`weight_${index}`} type="number" step="any" min="0" defaultValue={row.weight} aria-label={`Factor ${index + 1} weight`} />
                </td>
                <td>
                  <input name={`bad_${index}`} type="number" step="any" defaultValue={row.bad} aria-label={`Factor ${index + 1} value that scores 0`} />
                </td>
                <td>
                  <input name={`good_${index}`} type="number" step="any" defaultValue={row.good} aria-label={`Factor ${index + 1} value that scores 100`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label>
        Healthy from score
        <input name="green" type="number" min="0" max="100" step="any" defaultValue={thresholds.green} required />
      </label>
      <label>
        Watch from score
        <input name="amber" type="number" min="0" max="100" step="any" defaultValue={thresholds.amber} required />
      </label>
      <label>
        What changed and why
        <input name="changeNote" type="text" maxLength={300} defaultValue={changeNote} />
      </label>
      <div className="franchise-actions">
        <button type="submit" className="r2-button r2-button--primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
