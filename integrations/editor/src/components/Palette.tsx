import type { StepType } from "logicspec/core";
import { TYPE_GLYPHS } from "./StepNode";

const STEP_TYPES: StepType[] = [
  "page",
  "decision",
  "operation",
  "event",
  "wait",
  "subflow",
  "parallel",
  "error",
  "final",
];

interface PaletteProps {
  onAdd: (type: StepType) => void;
}

/** One button per step type; clicking inserts a template step into the YAML. */
export function Palette({ onAdd }: PaletteProps) {
  return (
    <div className="palette">
      {STEP_TYPES.map((type) => (
        <button key={type} type="button" title={`Add ${type} step`} onClick={() => onAdd(type)}>
          <span className="palette-glyph">{TYPE_GLYPHS[type]}</span>
          {type}
        </button>
      ))}
    </div>
  );
}
