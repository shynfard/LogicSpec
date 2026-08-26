import { useState } from "react";
import { Canvas } from "./Canvas";
import { MermaidView } from "./MermaidView";
import { StepDetailPanel } from "./StepDetailPanel";

export const DIAGRAM_VIEWS = [
  "interactive",
  "flow",
  "swimlane",
  "sequence",
  "event-model",
] as const;
export type DiagramView = (typeof DIAGRAM_VIEWS)[number];

export interface DiagramData {
  steps: Array<{
    id: string;
    type: string;
    label: string;
    actor?: string;
    description?: string;
    notes?: string;
    tags?: string[];
    requires?: string[];
    produces?: string[];
  }>;
  edges: Array<{ from: string; to: string; kind: string; label?: string }>;
  actors: Array<{ id: string; label: string }>;
  mermaid: Record<string, string>;
  clickMap: Record<string, { stepId: string; flow?: string }>;
}

export function DiagramTab({ diagram, view }: { diagram: DiagramData; view: DiagramView }) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  return (
    <div className="h-full">
      {view === "interactive" ? (
        <Canvas
          steps={diagram.steps}
          edges={diagram.edges}
          actors={diagram.actors}
          onStepClick={setSelectedStepId}
        />
      ) : (
        <MermaidView source={diagram.mermaid[view] ?? ""} />
      )}
      <StepDetailPanel
        steps={diagram.steps}
        edges={diagram.edges}
        clickMap={diagram.clickMap}
        stepId={selectedStepId}
        onOpenChange={(open) => {
          if (!open) setSelectedStepId(null);
        }}
      />
    </div>
  );
}
