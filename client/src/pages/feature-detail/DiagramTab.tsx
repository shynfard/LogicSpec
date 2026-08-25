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

const VIEWS = ["interactive", "flow", "swimlane", "sequence", "event-model"] as const;
type View = (typeof VIEWS)[number];

export interface DiagramData {
  steps: Array<{
    id: string;
    type: string;
    label: string;
    actor?: string;
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

  return (
    <div className="space-y-3">
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
      {view === "interactive" ? (
        <Canvas
          steps={diagram.steps}
          edges={diagram.edges}
          actors={diagram.actors}
          clickMap={diagram.clickMap}
        />
      ) : (
        <MermaidView source={diagram.mermaid[view] ?? ""} />
      )}
    </div>
  );
}
