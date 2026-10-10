"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { EditorState } from "./actions";

type Condition = { field: string; op: string; value: string };
type Step = Record<string, unknown> & { type: string };
type Setting = { name: string; value: string };

export type EditorInitial = {
  triggerEvent: string;
  settings: Record<string, number | string | boolean>;
  conditions: Array<{ field: string; op: string; value?: unknown }>;
  steps: Array<Record<string, unknown> & { type: string }>;
  changeNote: string;
};

const OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "exists", "contains"];
const STEP_TYPES = [
  { value: "create_task", label: "Create a task" },
  { value: "notify", label: "Send a notification" },
  { value: "request_approval", label: "Ask for approval" },
  { value: "wait", label: "Wait" },
  { value: "guard", label: "Stop unless a check passes" },
  { value: "run_action", label: "Run an action" }
];

function blankStep(type: string): Step {
  switch (type) {
    case "create_task":
      return { type, title: "", assignee: "territory" };
    case "notify":
      return { type, audience: "hq", title: "" };
    case "request_approval":
      return { type, approver: "hq", title: "" };
    case "wait":
      return { type, days: 1 };
    case "guard":
      return { type, check: "" };
    default:
      return { type: "run_action", action: "" };
  }
}

/** "3" -> 3, "@escalateAfterDays" -> { setting }, "" -> undefined. */
function parseNumberRef(text: string): number | { setting: string } | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("@")) return { setting: trimmed.slice(1) };
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : { setting: trimmed };
}

function showNumberRef(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && typeof (value as { setting?: unknown }).setting === "string") return `@${(value as { setting: string }).setting}`;
  return "";
}

function parseConditionValue(op: string, text: string): unknown {
  if (op === "exists") return undefined;
  if (op === "in") return text.split(",").map((part) => part.trim()).filter(Boolean).map((part) => (Number.isFinite(Number(part)) ? Number(part) : part));
  if (["gt", "gte", "lt", "lte"].includes(op)) return Number(text);
  return text === "true" ? true : text === "false" ? false : Number.isFinite(Number(text)) && text.trim() !== "" ? Number(text) : text;
}

function parseSetting(value: string): number | string | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value;
}

export function WorkflowDraftEditor({
  action,
  initial,
  hooks,
  sampleHint,
  runsBase
}: {
  action: (previous: EditorState, formData: FormData) => Promise<EditorState>;
  initial: EditorInitial;
  hooks: { actions: string[]; guards: string[] };
  sampleHint: string;
  runsBase: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [triggerEvent, setTriggerEvent] = useState(initial.triggerEvent);
  const [settings, setSettings] = useState<Setting[]>(Object.entries(initial.settings).map(([name, value]) => ({ name, value: String(value) })));
  const [conditions, setConditions] = useState<Condition[]>(
    initial.conditions.map((condition) => ({ field: condition.field, op: condition.op, value: Array.isArray(condition.value) ? condition.value.join(", ") : condition.value === undefined ? "" : String(condition.value) }))
  );
  const [steps, setSteps] = useState<Step[]>(initial.steps);

  const definition = JSON.stringify({
    triggerEvent,
    settings: Object.fromEntries(settings.filter((setting) => setting.name.trim()).map((setting) => [setting.name.trim(), parseSetting(setting.value)])),
    conditions: conditions.map((condition) => ({ field: condition.field, op: condition.op, value: parseConditionValue(condition.op, condition.value) })),
    steps
  });

  const patchStep = (index: number, patch: Record<string, unknown>) =>
    setSteps((current) => current.map((step, position) => (position === index ? ({ ...step, ...patch } as Step) : step)));
  const moveStep = (index: number, delta: number) =>
    setSteps((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  return (
    <form action={formAction} className="franchise-form workflow-editor">
      <input type="hidden" name="definition" value={definition} />

      {state && state.errors.length > 0 ? (
        <div role="alert" className="notice notice--error">
          <strong>Fix these before continuing:</strong>
          <ul>
            {state.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {state?.message ? (
        <p role="status" className="notice notice--success">
          {state.message}{" "}
          {state.testRunId ? <Link href={`${runsBase}/${state.testRunId}` as never}>Review the test run</Link> : null}
        </p>
      ) : null}

      <label>
        Trigger event
        <input value={triggerEvent} onChange={(event) => setTriggerEvent(event.target.value)} required />
      </label>

      <fieldset>
        <legend>Thresholds</legend>
        <p className="journey-builder-step-note">Steps can use a threshold by writing @name, e.g. <code>@escalateAfterDays</code>, so it can be tuned here without editing steps.</p>
        {settings.map((setting, index) => (
          <div key={index} className="workflow-row">
            <input aria-label="Threshold name" value={setting.name} placeholder="name" onChange={(event) => setSettings((current) => current.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))} />
            <input aria-label={`Value for ${setting.name || "threshold"}`} value={setting.value} placeholder="value" onChange={(event) => setSettings((current) => current.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)))} />
            <button type="button" className="r2-button r2-button--secondary" onClick={() => setSettings((current) => current.filter((_, i) => i !== index))}>Remove</button>
          </div>
        ))}
        <button type="button" className="r2-button r2-button--secondary" onClick={() => setSettings((current) => [...current, { name: "", value: "" }])}>Add threshold</button>
      </fieldset>

      <fieldset>
        <legend>Only run when (all must be true)</legend>
        <p className="journey-builder-step-note">Fields look like <code>event.payload.balanceMinor</code>. Leave empty to run for every event.</p>
        {conditions.map((condition, index) => (
          <div key={index} className="workflow-row">
            <input aria-label="Condition field" value={condition.field} placeholder="event.payload.field" onChange={(event) => setConditions((current) => current.map((item, i) => (i === index ? { ...item, field: event.target.value } : item)))} />
            <select aria-label="Condition operator" value={condition.op} onChange={(event) => setConditions((current) => current.map((item, i) => (i === index ? { ...item, op: event.target.value } : item)))}>
              {OPS.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            <input aria-label="Condition value" value={condition.value} disabled={condition.op === "exists"} placeholder="value" onChange={(event) => setConditions((current) => current.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)))} />
            <button type="button" className="r2-button r2-button--secondary" onClick={() => setConditions((current) => current.filter((_, i) => i !== index))}>Remove</button>
          </div>
        ))}
        <button type="button" className="r2-button r2-button--secondary" onClick={() => setConditions((current) => [...current, { field: "event.payload.", op: "eq", value: "" }])}>Add condition</button>
      </fieldset>

      <fieldset>
        <legend>Steps (run in order)</legend>
        {steps.map((step, index) => (
          <div key={index} className="workflow-step">
            <div className="workflow-row">
              <strong>{index + 1}.</strong>
              <select aria-label={`Step ${index + 1} type`} value={step.type} onChange={(event) => setSteps((current) => current.map((item, i) => (i === index ? blankStep(event.target.value) : item)))}>
                {STEP_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
              <button type="button" className="r2-button r2-button--secondary" onClick={() => moveStep(index, -1)} disabled={index === 0} aria-label={`Move step ${index + 1} up`}>Up</button>
              <button type="button" className="r2-button r2-button--secondary" onClick={() => moveStep(index, 1)} disabled={index === steps.length - 1} aria-label={`Move step ${index + 1} down`}>Down</button>
              <button type="button" className="r2-button r2-button--secondary" onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}>Remove</button>
            </div>

            {step.type === "create_task" ? (
              <>
                <input aria-label="Task title" placeholder="Task title (supports {{event.payload.x}})" value={String(step.title ?? "")} onChange={(event) => patchStep(index, { title: event.target.value })} />
                <input aria-label="Task description" placeholder="Description (optional)" value={String(step.description ?? "")} onChange={(event) => patchStep(index, { description: event.target.value || undefined })} />
                <select aria-label="Assignee" value={String(step.assignee ?? "territory")} onChange={(event) => patchStep(index, { assignee: event.target.value })}>
                  <option value="territory">Territory team</option>
                  <option value="hq">Head Office</option>
                </select>
                <input aria-label="Due in days" placeholder="Due in days, e.g. 3 or @name" value={showNumberRef(step.dueInDays)} onChange={(event) => patchStep(index, { dueInDays: parseNumberRef(event.target.value) })} />
                <input aria-label="Link" placeholder="Link, e.g. /app/finance (optional)" value={String(step.link ?? "")} onChange={(event) => patchStep(index, { link: event.target.value || undefined })} />
              </>
            ) : null}

            {step.type === "notify" ? (
              <>
                <input aria-label="Notification title" placeholder="Title" value={String(step.title ?? "")} onChange={(event) => patchStep(index, { title: event.target.value })} />
                <input aria-label="Notification body" placeholder="Message (optional)" value={String(step.body ?? "")} onChange={(event) => patchStep(index, { body: event.target.value || undefined })} />
                <select aria-label="Audience" value={String(step.audience ?? "hq")} onChange={(event) => patchStep(index, { audience: event.target.value })}>
                  <option value="hq">Head Office</option>
                  <option value="territory">Territory team</option>
                </select>
                <input aria-label="Link" placeholder="Link (optional)" value={String(step.link ?? "")} onChange={(event) => patchStep(index, { link: event.target.value || undefined })} />
              </>
            ) : null}

            {step.type === "request_approval" ? (
              <>
                <input aria-label="Approval question" placeholder="What needs approving?" value={String(step.title ?? "")} onChange={(event) => patchStep(index, { title: event.target.value })} />
                <input aria-label="Approval detail" placeholder="Detail (optional)" value={String(step.description ?? "")} onChange={(event) => patchStep(index, { description: event.target.value || undefined })} />
                <select aria-label="Approver" value={String(step.approver ?? "hq")} onChange={(event) => patchStep(index, { approver: event.target.value })}>
                  <option value="hq">Head Office</option>
                  <option value="territory">Territory team</option>
                </select>
                <input aria-label="Expires in days" placeholder="Expires in days, e.g. 14 or @name (cancels the run)" value={showNumberRef(step.expiresInDays)} onChange={(event) => patchStep(index, { expiresInDays: parseNumberRef(event.target.value) })} />
              </>
            ) : null}

            {step.type === "wait" ? (
              <>
                <input aria-label="Wait days" placeholder="Days, e.g. 7 or @name" value={showNumberRef(step.days)} onChange={(event) => patchStep(index, { days: parseNumberRef(event.target.value) })} />
                <input aria-label="Wait hours" placeholder="Hours (optional)" value={showNumberRef(step.hours)} onChange={(event) => patchStep(index, { hours: parseNumberRef(event.target.value) })} />
              </>
            ) : null}

            {step.type === "guard" ? (
              <select aria-label="Check" value={String(step.check ?? "")} onChange={(event) => patchStep(index, { check: event.target.value })}>
                <option value="">Choose a check</option>
                {hooks.guards.map((guard) => (
                  <option key={guard} value={guard}>{guard}</option>
                ))}
              </select>
            ) : null}

            {step.type === "run_action" ? (
              <select aria-label="Action" value={String(step.action ?? "")} onChange={(event) => patchStep(index, { action: event.target.value })}>
                <option value="">Choose an action</option>
                {hooks.actions.map((hook) => (
                  <option key={hook} value={hook}>{hook}</option>
                ))}
              </select>
            ) : null}
          </div>
        ))}
        <button type="button" className="r2-button r2-button--secondary" onClick={() => setSteps((current) => [...current, blankStep("notify")])}>Add step</button>
      </fieldset>

      <label>
        What changed? (optional)
        <input name="changeNote" maxLength={300} defaultValue={initial.changeNote} />
      </label>

      <fieldset>
        <legend>Test before activating</legend>
        <p className="journey-builder-step-note">A test run records what each step would do. It sends nothing and creates no tasks, approvals or notifications.</p>
        <label>
          Sample event data (JSON)
          <textarea name="samplePayload" rows={4} defaultValue={sampleHint} />
        </label>
        <label>
          Sample record id (optional, used by checks like invoice.still_unpaid)
          <input name="sampleSubjectId" placeholder="uuid" />
        </label>
      </fieldset>

      <div className="franchise-actions">
        <button type="submit" className="r2-button r2-button--primary" name="intent" value="save" disabled={pending}>Save draft</button>
        <button type="submit" className="r2-button r2-button--secondary" name="intent" value="test" disabled={pending}>Save and test run</button>
        <button type="submit" className="r2-button r2-button--secondary" name="intent" value="activate" disabled={pending}>Save and activate</button>
      </div>
    </form>
  );
}
