"use client";

import { useEffect, useState, useTransition } from "react";
import type { SegmentRuleCondition, SegmentRuleField, SegmentRuleGroup, SegmentRuleOperator } from "@raring2go/marketing";

const FIELD_OPTIONS: Array<{ value: SegmentRuleField; label: string }> = [
  { value: "territoryId", label: "Territory" },
  { value: "subscriptionStatus", label: "Subscription status" },
  { value: "tag", label: "Tag" },
  { value: "consentType", label: "Consent type" },
  { value: "interest", label: "Interest" },
  { value: "activityWithinDays", label: "Days since last activity (at most)" }
];

const OPERATOR_OPTIONS: Array<{ value: SegmentRuleOperator; label: string }> = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "does not equal" },
  { value: "in", label: "is any of (comma separated)" },
  { value: "not_in", label: "is none of (comma separated)" },
  { value: "contains", label: "contains" },
  { value: "is_set", label: "is set" },
  { value: "is_not_set", label: "is not set" }
];

function newCondition(): SegmentRuleCondition {
  return { kind: "condition", field: "tag", operator: "equals", value: "" };
}

function newGroup(): SegmentRuleGroup {
  return { kind: "group", match: "all", children: [] };
}

export type PreviewSegmentAudience = (input: { territoryId: string | null; definition: unknown }) => Promise<{ count: number }>;

export function SegmentRuleBuilder({
  initialRoot,
  territoryOptions,
  defaultTerritoryId,
  previewAction
}: {
  initialRoot: SegmentRuleGroup;
  territoryOptions: Array<{ id: string; name: string }>;
  defaultTerritoryId: string | null;
  previewAction: PreviewSegmentAudience;
}) {
  const [root, setRoot] = useState<SegmentRuleGroup>(initialRoot);
  const [territoryId, setTerritoryId] = useState<string>(defaultTerritoryId ?? "");
  const [preview, setPreview] = useState<{ count: number } | { error: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const canPickTerritory = territoryOptions.length > 1;

  useEffect(() => {
    const timeout = setTimeout(() => {
      startTransition(async () => {
        try {
          const result = await previewAction({ territoryId: territoryId || null, definition: { version: 1, root } });
          setPreview(result);
        } catch (error) {
          setPreview({ error: error instanceof Error ? error.message : "Preview failed." });
        }
      });
    }, 400);

    return () => clearTimeout(timeout);
  }, [root, territoryId, previewAction]);

  return (
    <div className="segment-builder">
      <input type="hidden" name="definitionJson" value={JSON.stringify({ version: 1, root })} />
      {canPickTerritory ? (
        <label className="segment-builder-territory">
          Territory
          <select name="territoryId" value={territoryId} onChange={(event) => setTerritoryId(event.target.value)}>
            <option value="">All territories (national)</option>
            {territoryOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <input type="hidden" name="territoryId" value={territoryId} />
          <p className="segment-builder-territory-fixed">Territory: {territoryOptions[0]?.name ?? "Your territory"}</p>
        </>
      )}

      <GroupEditor group={root} onChange={setRoot} path="root" depth={0} />

      <div className="segment-builder-preview">
        {isPending ? (
          <span className="segment-builder-preview-loading">Calculating…</span>
        ) : preview && "count" in preview ? (
          <span>
            <strong>{preview.count}</strong> matching contact{preview.count === 1 ? "" : "s"}
          </span>
        ) : preview && "error" in preview ? (
          <span className="block-editor-error">{preview.error}</span>
        ) : null}
      </div>
    </div>
  );
}

function GroupEditor({
  group,
  onChange,
  path,
  depth
}: {
  group: SegmentRuleGroup;
  onChange: (next: SegmentRuleGroup) => void;
  path: string;
  depth: number;
}) {
  function updateChild(index: number, next: SegmentRuleCondition | SegmentRuleGroup) {
    const children = group.children.slice();
    children[index] = next;
    onChange({ ...group, children });
  }

  function removeChild(index: number) {
    onChange({ ...group, children: group.children.filter((_, candidateIndex) => candidateIndex !== index) });
  }

  return (
    <div className="segment-builder-group">
      <div className="segment-builder-group-header">
        <span>Match</span>
        <select value={group.match} onChange={(event) => onChange({ ...group, match: event.target.value as "all" | "any" })}>
          <option value="all">all of</option>
          <option value="any">any of</option>
        </select>
        <span>the following:</span>
      </div>

      {group.children.map((child, index) =>
        child.kind === "group" ? (
          <div key={`${path}.${index}`} className="segment-builder-nested-group">
            <GroupEditor group={child} onChange={(next) => updateChild(index, next)} path={`${path}.${index}`} depth={depth + 1} />
            <button type="button" onClick={() => removeChild(index)}>
              Remove nested group
            </button>
          </div>
        ) : (
          <ConditionEditor
            key={`${path}.${index}`}
            condition={child}
            onChange={(next) => updateChild(index, next)}
            onRemove={() => removeChild(index)}
          />
        )
      )}

      <div className="segment-builder-add-row">
        <button type="button" onClick={() => onChange({ ...group, children: [...group.children, newCondition()] })}>
          + Condition
        </button>
        <button type="button" onClick={() => onChange({ ...group, children: [...group.children, newGroup()] })}>
          + Nested group
        </button>
      </div>
    </div>
  );
}

function ConditionEditor({
  condition,
  onChange,
  onRemove
}: {
  condition: SegmentRuleCondition;
  onChange: (next: SegmentRuleCondition) => void;
  onRemove: () => void;
}) {
  const valueText = Array.isArray(condition.value) ? condition.value.join(", ") : condition.value != null ? String(condition.value) : "";
  const needsValue = condition.operator !== "is_set" && condition.operator !== "is_not_set";

  function handleValueChange(text: string) {
    if (condition.operator === "in" || condition.operator === "not_in") {
      onChange({ ...condition, value: text.split(",").map((entry) => entry.trim()).filter(Boolean) });
      return;
    }
    if (condition.field === "activityWithinDays") {
      const parsed = Number(text);
      onChange({ ...condition, value: Number.isFinite(parsed) ? parsed : text });
      return;
    }
    onChange({ ...condition, value: text });
  }

  return (
    <div className="segment-builder-condition">
      <select
        value={condition.field}
        onChange={(event) => onChange({ ...condition, field: event.target.value as SegmentRuleField, value: "" })}
      >
        {FIELD_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select value={condition.operator} onChange={(event) => onChange({ ...condition, operator: event.target.value as SegmentRuleOperator })}>
        {OPERATOR_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {needsValue ? (
        <input type="text" value={valueText} onChange={(event) => handleValueChange(event.target.value)} placeholder="Value" />
      ) : null}
      <button type="button" onClick={onRemove} aria-label="Remove condition">
        Remove
      </button>
    </div>
  );
}
