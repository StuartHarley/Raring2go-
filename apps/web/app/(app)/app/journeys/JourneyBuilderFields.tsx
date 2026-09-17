"use client";

import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { JourneyCondition, JourneyStep } from "@raring2go/marketing";

// Mirrors SegmentRuleBuilder's condition options exactly - journey conditions
// reuse SegmentRuleCondition unmodified, so the same field/operator vocabulary applies.
const FIELD_OPTIONS = [
  { value: "territoryId", label: "Territory" },
  { value: "subscriptionStatus", label: "Subscription status" },
  { value: "tag", label: "Tag" },
  { value: "consentType", label: "Consent type" },
  { value: "interest", label: "Interest" },
  { value: "activityWithinDays", label: "Days since last activity (at most)" }
] as const;

const OPERATOR_OPTIONS = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "does not equal" },
  { value: "in", label: "is any of (comma separated)" },
  { value: "not_in", label: "is none of (comma separated)" },
  { value: "contains", label: "contains" },
  { value: "is_set", label: "is set" },
  { value: "is_not_set", label: "is not set" }
] as const;

function newCondition(): JourneyCondition {
  return { kind: "condition", field: "tag", operator: "equals", value: "" };
}

function newStep(delayMinutes: number): JourneyStep {
  return {
    key: `step-${crypto.randomUUID().slice(0, 8)}`,
    actionType: "send_email",
    delayMinutes,
    email: { subject: "", blocks: [{ id: crypto.randomUUID(), type: "text", html: "" }] }
  };
}

export type JourneyBuilderInitialValue = {
  name: string;
  description: string;
  territoryId: string;
  conditions: JourneyCondition[];
  steps: JourneyStep[];
};

export function JourneyBuilderFields({
  initial,
  territoryOptions
}: {
  initial: JourneyBuilderInitialValue;
  territoryOptions: Array<{ id: string; name: string }>;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [territoryId, setTerritoryId] = useState(initial.territoryId);
  const [conditions, setConditions] = useState<JourneyCondition[]>(initial.conditions);
  const [steps, setSteps] = useState<JourneyStep[]>(initial.steps.length > 0 ? initial.steps : [newStep(0)]);
  const canPickTerritory = territoryOptions.length > 1;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function updateCondition(index: number, next: JourneyCondition) {
    setConditions((current) => current.map((condition, candidateIndex) => (candidateIndex === index ? next : condition)));
  }

  function removeCondition(index: number) {
    setConditions((current) => current.filter((_, candidateIndex) => candidateIndex !== index));
  }

  function updateStep(key: string, patch: Partial<JourneyStep>) {
    setSteps((current) => current.map((step) => (step.key === key ? { ...step, ...patch } : step)));
  }

  function removeStep(key: string) {
    setSteps((current) => (current.length <= 1 ? current : current.filter((step) => step.key !== key)));
  }

  function addStep() {
    setSteps((current) => [...current, newStep(60)]);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = steps.findIndex((step) => step.key === active.id);
    const newIndex = steps.findIndex((step) => step.key === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setSteps(arrayMove(steps, oldIndex, newIndex));
  }

  return (
    <div className="journey-builder">
      <label>
        Name
        <input name="name" value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label>
        Description
        <textarea name="description" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
      </label>

      {canPickTerritory ? (
        <label>
          Territory
          <select name="territoryId" value={territoryId} onChange={(event) => setTerritoryId(event.target.value)}>
            <option value="">All territories (network)</option>
            {territoryOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="territoryId" value={territoryId} />
      )}

      <input type="hidden" name="trigger" value="contact_subscribed_to_territory" />
      <p className="journey-builder-trigger-note">
        Trigger: a contact subscribes to the territory above{canPickTerritory ? " (or any territory, if set to network-wide)" : ""}.
      </p>

      <div className="segment-builder-group">
        <div className="segment-builder-group-header">
          <span>Only enter contacts who also match all of the following:</span>
        </div>
        {conditions.map((condition, index) => (
          <ConditionEditor
            key={index}
            condition={condition}
            onChange={(next) => updateCondition(index, next)}
            onRemove={() => removeCondition(index)}
          />
        ))}
        <div className="segment-builder-add-row">
          <button type="button" onClick={() => setConditions((current) => [...current, newCondition()])}>
            + Condition
          </button>
        </div>
      </div>
      <input type="hidden" name="conditionsJson" value={JSON.stringify(conditions)} />

      <h3 className="journey-builder-steps-title">Steps</h3>
      <DndContext id="journey-builder-steps" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={steps.map((step) => step.key)} strategy={verticalListSortingStrategy}>
          <div className="block-editor-list">
            {steps.map((step, index) => (
              <SortableStepRow
                key={step.key}
                step={step}
                index={index}
                canRemove={steps.length > 1}
                onChange={(patch) => updateStep(step.key, patch)}
                onRemove={() => removeStep(step.key)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="block-editor-add-menu">
        <button type="button" onClick={addStep}>+ Step</button>
      </div>
      <input type="hidden" name="stepsJson" value={JSON.stringify(steps)} />
    </div>
  );
}

function SortableStepRow({
  step,
  index,
  canRemove,
  onChange,
  onRemove
}: {
  step: JourneyStep;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<JourneyStep>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.key });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const html = step.email.blocks[0]?.type === "text" ? step.email.blocks[0].html : "";

  return (
    <div ref={setNodeRef} style={style} className="block-editor-row">
      <div className="block-editor-row-header">
        <button type="button" className="block-editor-drag-handle" aria-label="Reorder step" {...attributes} {...listeners}>
          ⠿
        </button>
        <span className="block-editor-row-type">Step {index + 1}</span>
        <button type="button" onClick={onRemove} disabled={!canRemove} aria-label="Remove step">
          Remove
        </button>
      </div>
      <label>
        Email subject
        <input
          value={step.email.subject}
          onChange={(event) => onChange({ email: { ...step.email, subject: event.target.value } })}
          required
        />
      </label>
      <label>
        Email content
        <textarea
          value={html}
          onChange={(event) =>
            onChange({
              email: {
                ...step.email,
                blocks: [{ id: step.email.blocks[0]?.id ?? crypto.randomUUID(), type: "text", html: event.target.value }]
              }
            })
          }
          rows={4}
        />
      </label>
      {index === 0 ? (
        <p className="journey-builder-step-note">The first step runs as soon as a contact enters the journey.</p>
      ) : (
        <label>
          Wait before this step (minutes)
          <input
            type="number"
            min={0}
            value={step.delayMinutes}
            onChange={(event) => onChange({ delayMinutes: Math.max(0, Number(event.target.value) || 0) })}
          />
        </label>
      )}
    </div>
  );
}

function ConditionEditor({
  condition,
  onChange,
  onRemove
}: {
  condition: JourneyCondition;
  onChange: (next: JourneyCondition) => void;
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
        onChange={(event) => onChange({ ...condition, field: event.target.value as JourneyCondition["field"], value: "" })}
      >
        {FIELD_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        value={condition.operator}
        onChange={(event) => onChange({ ...condition, operator: event.target.value as JourneyCondition["operator"] })}
      >
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
