import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { StepFlowNode, TransitionEdge } from "../lib/editorState";
import { StepNode } from "./StepNode";

const nodeTypes = { step: StepNode };

interface CanvasProps {
  nodes: StepFlowNode[];
  edges: TransitionEdge[];
  /** Dim the canvas while the YAML has validation errors. */
  dimmed: boolean;
  onNodesChange: (changes: NodeChange<StepFlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<TransitionEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  onSelectionChange: (params: OnSelectionChangeParams) => void;
}

export function Canvas({
  nodes,
  edges,
  dimmed,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelectionChange,
}: CanvasProps) {
  return (
    <div className={`canvas${dimmed ? " dimmed" : ""}`}>
      <ReactFlow<StepFlowNode, TransitionEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        deleteKeyCode={["Backspace", "Delete"]}
        colorMode="system"
        fitView
      >
        <Background />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
    </div>
  );
}
