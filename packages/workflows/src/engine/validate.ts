import { isValidContextPath, templatePattern } from "./evaluate";
import { workflowStepTypes } from "./types";
import type { NumberRef, WorkflowCondition, WorkflowSettings, WorkflowStep } from "./types";

export type ValidatedWorkflowVersion = {
  triggerEvent: string;
  conditions: WorkflowCondition[];
  steps: WorkflowStep[];
  settings: WorkflowSettings;
};

export type WorkflowValidationResult = { ok: true; value: ValidatedWorkflowVersion } | { ok: false; errors: string[] };

/** Names a definition may reference; keeps drafts from being activated with unknown hooks. */
export type KnownHooks = { actions: ReadonlySet<string>; guards: ReadonlySet<string> };

const eventPattern = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const settingNamePattern = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const operators = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "in", "exists", "contains"]);
export const MAX_STEPS = 30;
const MAX_TEXT = 500;
const MAX_DAYS = 365;

/**
 * Structural validation for a workflow version. Pure and total: it never throws and
 * reports every problem, so the builder UI can show them all at once.
 */
export function validateWorkflowVersion(input: unknown, hooks?: KnownHooks): WorkflowValidationResult {
  const errors: string[] = [];
  const record = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  const triggerEvent = typeof record.triggerEvent === "string" ? record.triggerEvent.trim() : "";
  if (!eventPattern.test(triggerEvent)) {
    errors.push('Trigger event must be dot-case, e.g. "franchise.agreement.executed".');
  }

  const settings = validateSettings(record.settings, errors);
  const conditions = validateConditions(record.conditions, errors);
  const steps = validateSteps(record.steps, settings, hooks, errors);

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { triggerEvent, conditions, steps, settings } };
}

function validateSettings(value: unknown, errors: string[]): WorkflowSettings {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("Settings must be an object of named thresholds.");
    return {};
  }
  const settings: WorkflowSettings = {};
  for (const [name, setting] of Object.entries(value)) {
    if (!settingNamePattern.test(name)) {
      errors.push(`Setting name "${name}" is not valid.`);
    } else if (typeof setting === "number" && Number.isFinite(setting)) {
      settings[name] = setting;
    } else if (typeof setting === "string" || typeof setting === "boolean") {
      settings[name] = setting;
    } else {
      errors.push(`Setting "${name}" must be a number, string or boolean.`);
    }
  }
  return settings;
}

function validateConditions(value: unknown, errors: string[]): WorkflowCondition[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push("Conditions must be a list.");
    return [];
  }
  const conditions: WorkflowCondition[] = [];
  value.forEach((raw, index) => {
    const condition = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const label = `Condition ${index + 1}`;
    if (typeof condition.field !== "string" || !isValidContextPath(condition.field)) {
      errors.push(`${label}: field must be a path under event, scope or settings (e.g. event.payload.balanceMinor).`);
      return;
    }
    if (typeof condition.op !== "string" || !operators.has(condition.op)) {
      errors.push(`${label}: unknown operator.`);
      return;
    }
    if (condition.op === "in" && !Array.isArray(condition.value)) {
      errors.push(`${label}: "in" needs a list of values.`);
      return;
    }
    if (["gt", "gte", "lt", "lte"].includes(condition.op) && typeof condition.value !== "number") {
      errors.push(`${label}: comparison needs a number.`);
      return;
    }
    conditions.push({ field: condition.field, op: condition.op as WorkflowCondition["op"], value: condition.value });
  });
  return conditions;
}

function checkText(value: unknown, label: string, errors: string[], required = true): string | undefined {
  if (value === undefined || value === "") {
    if (required) errors.push(`${label} is required.`);
    return undefined;
  }
  if (typeof value !== "string" || value.length > MAX_TEXT) {
    errors.push(`${label} must be text of at most ${MAX_TEXT} characters.`);
    return undefined;
  }
  for (const match of value.matchAll(templatePattern)) {
    if (!isValidContextPath(match[1] ?? "")) {
      errors.push(`${label}: placeholder {{${match[1]}}} must start with event., scope. or settings.`);
    }
  }
  return value;
}

function checkNumber(value: unknown, label: string, settings: WorkflowSettings, errors: string[]): NumberRef | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > MAX_DAYS) {
      errors.push(`${label} must be between 0 and ${MAX_DAYS}.`);
      return undefined;
    }
    return value;
  }
  if (value && typeof value === "object" && typeof (value as { setting?: unknown }).setting === "string") {
    const name = (value as { setting: string }).setting;
    const resolved = settings[name];
    if (typeof resolved !== "number" || resolved < 0 || resolved > MAX_DAYS) {
      errors.push(`${label} refers to setting "${name}", which must be a number between 0 and ${MAX_DAYS}.`);
      return undefined;
    }
    return { setting: name };
  }
  errors.push(`${label} must be a number or { "setting": "name" }.`);
  return undefined;
}

function validateSteps(value: unknown, settings: WorkflowSettings, hooks: KnownHooks | undefined, errors: string[]): WorkflowStep[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("A workflow needs at least one step.");
    return [];
  }
  if (value.length > MAX_STEPS) {
    errors.push(`A workflow can have at most ${MAX_STEPS} steps.`);
    return [];
  }

  const steps: WorkflowStep[] = [];
  value.forEach((raw, index) => {
    const step = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const label = `Step ${index + 1}`;
    const type = step.type;

    if (typeof type !== "string" || !workflowStepTypes.includes(type as WorkflowStep["type"])) {
      errors.push(`${label}: unknown step type.`);
      return;
    }

    switch (type) {
      case "create_task": {
        const title = checkText(step.title, `${label} title`, errors);
        const description = checkText(step.description, `${label} description`, errors, false);
        const link = checkText(step.link, `${label} link`, errors, false);
        const dueInDays = checkNumber(step.dueInDays, `${label} due days`, settings, errors);
        if (step.assignee !== "territory" && step.assignee !== "hq") errors.push(`${label}: assignee must be "territory" or "hq".`);
        if (title && (step.assignee === "territory" || step.assignee === "hq")) {
          steps.push({ type, title, description, assignee: step.assignee, dueInDays, link });
        }
        break;
      }
      case "notify": {
        const title = checkText(step.title, `${label} title`, errors);
        const body = checkText(step.body, `${label} body`, errors, false);
        const link = checkText(step.link, `${label} link`, errors, false);
        if (step.audience !== "territory" && step.audience !== "hq") errors.push(`${label}: audience must be "territory" or "hq".`);
        if (title && (step.audience === "territory" || step.audience === "hq")) {
          steps.push({ type, audience: step.audience, title, body, link });
        }
        break;
      }
      case "request_approval": {
        const title = checkText(step.title, `${label} title`, errors);
        const description = checkText(step.description, `${label} description`, errors, false);
        const expiresInDays = checkNumber(step.expiresInDays, `${label} expiry days`, settings, errors);
        if (step.approver !== "territory" && step.approver !== "hq") errors.push(`${label}: approver must be "territory" or "hq".`);
        if (title && (step.approver === "territory" || step.approver === "hq")) {
          steps.push({ type, approver: step.approver, title, description, expiresInDays });
        }
        break;
      }
      case "wait": {
        const days = checkNumber(step.days, `${label} days`, settings, errors);
        const hours = checkNumber(step.hours, `${label} hours`, settings, errors);
        if (days === undefined && hours === undefined) errors.push(`${label}: a wait needs days or hours.`);
        else steps.push({ type, days, hours });
        break;
      }
      case "guard": {
        if (typeof step.check !== "string" || !step.check) errors.push(`${label}: guard needs a check name.`);
        else if (hooks && !hooks.guards.has(step.check)) errors.push(`${label}: unknown guard "${step.check}".`);
        else steps.push({ type, check: step.check, params: asParams(step.params, label, errors) });
        break;
      }
      case "run_action": {
        if (typeof step.action !== "string" || !step.action) errors.push(`${label}: action needs a name.`);
        else if (hooks && !hooks.actions.has(step.action)) errors.push(`${label}: unknown action "${step.action}".`);
        else steps.push({ type, action: step.action, params: asParams(step.params, label, errors) });
        break;
      }
    }
  });

  return steps;
}

function asParams(value: unknown, label: string, errors: string[]): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label}: params must be an object.`);
    return undefined;
  }
  return value as Record<string, unknown>;
}
