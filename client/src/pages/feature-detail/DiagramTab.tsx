import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Canvas } from "./Canvas";
import { MermaidView } from "./MermaidView";
import { StepDetailPanel } from "./StepDetailPanel";

const VIEWS = ["interactive", "flow", "swimlane", "sequence", "event-model"] as const;
type View = (typeof VIEWS)[number];

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

export function DiagramTab({ diagram }: { diagram: DiagramData }) {
  const [view, setView] = useState<View>("interactive");
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  return (
    // Breaks out of the page's centered max-w-4xl column: `left-1/2` +
    // `-translate-x-1/2` re-centers a `w-screen` box on the viewport
    // regardless of the ancestor's own width/padding, so the diagram gets
    // the full browser width instead of being boxed into the readable-text
    // column the other tabs use.
    <div className="relative left-1/2 w-screen -translate-x-1/2 space-y-3 px-6">
      <Select value={view} onValueChange={(v) => setView(v as View)}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VIEWS.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="h-[calc(100vh-220px)]">
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
      </div>
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
