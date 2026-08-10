import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { StepFlowNode } from "../lib/editorState";

export const TYPE_GLYPHS: Record<string, string> = {
  page: "▭",
  decision: "◇",
  operation: "▣",
  event: "▷",
  wait: "⏱",
  subflow: "⧉",
  parallel: "⫽",
  error: "⚠",
  final: "◎",
};

/** Card for one step; shape semantics carried by badge + per-type accents. */
export function StepNode({ data }: NodeProps<StepFlowNode>) {
  const { step } = data;
  return (
    <div className={`step-node type-${step.type}`}>
      <Handle type="target" position={Position.Top} />
      <div className="step-badge">
        <span className="step-glyph">{TYPE_GLYPHS[step.type]}</span>
        {step.type.toUpperCase()}
      </div>
      <div className="step-label">{step.label}</div>
      {step.actor !== undefined && <div className="step-actor">@{step.actor}</div>}
      {step.type !== "final" && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}
