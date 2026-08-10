import { useEffect, useState } from "react";
import type { EditableStepField, NormalizedStep } from "logicspec/core";

interface InspectorProps {
  step?: NormalizedStep;
  actors: string[];
  onRename: (oldId: string, newId: string) => void;
  onSetField: (id: string, field: EditableStepField, value: string | undefined) => void;
}

/** Edits scalar properties of the selected step; commits on blur. */
export function Inspector({ step, actors, onRename, onSetField }: InspectorProps) {
  const [idDraft, setIdDraft] = useState(step?.id ?? "");
  useEffect(() => {
    setIdDraft(step?.id ?? "");
  }, [step?.id]);

  if (!step) {
    return <p className="hint">Select a step to edit it.</p>;
  }

  const commit = (field: EditableStepField, raw: string) => {
    const value = raw.trim() === "" ? undefined : raw;
    onSetField(step.id, field, value);
  };

  return (
    <div className="inspector">
      <label>
        id
        <div className="row">
          <input value={idDraft} onChange={(event) => setIdDraft(event.target.value)} />
          <button
            type="button"
            disabled={idDraft.trim() === "" || idDraft === step.id}
            onClick={() => onRename(step.id, idDraft.trim())}
          >
            Rename
          </button>
        </div>
      </label>

      <label>
        label
        <input
          key={`${step.id}-label`}
          defaultValue={step.label}
          onBlur={(event) => commit("label", event.target.value)}
        />
      </label>

      <label>
        actor
        <select
          key={`${step.id}-actor`}
          defaultValue={step.actor ?? ""}
          onChange={(event) => commit("actor", event.target.value)}
        >
          <option value="">(none)</option>
          {actors.map((actor) => (
            <option key={actor} value={actor}>
              {actor}
            </option>
          ))}
        </select>
      </label>

      <label>
        description
        <textarea
          key={`${step.id}-description`}
          rows={3}
          defaultValue={step.description ?? ""}
          onBlur={(event) => commit("description", event.target.value)}
        />
      </label>

      {step.def.type === "page" && (
        <label>
          route
          <input
            key={`${step.id}-route`}
            defaultValue={step.def.route ?? ""}
            onBlur={(event) => commit("route", event.target.value)}
          />
        </label>
      )}

      {step.def.type === "error" && (
        <label>
          message
          <input
            key={`${step.id}-message`}
            defaultValue={step.def.message ?? ""}
            onBlur={(event) => commit("message", event.target.value)}
          />
        </label>
      )}

      {step.def.type === "decision" && (
        <label>
          expression
          <input
            key={`${step.id}-expression`}
            defaultValue={step.def.expression ?? ""}
            onBlur={(event) => commit("expression", event.target.value)}
          />
        </label>
      )}

      <p className="meta">
        type: {step.type} · transitions: {step.transitions.length}
      </p>
      <p className="hint">
        Draw an edge between nodes to add a transition. Select a node or edge and press Delete to
        remove it.
      </p>
    </div>
  );
}
