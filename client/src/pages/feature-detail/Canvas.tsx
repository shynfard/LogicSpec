// client/src/pages/feature-detail/Canvas.tsx
import dagre from "@dagrejs/dagre";
import {
  applyNodeChanges,
  Background,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeChange,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { navigate } from "@/lib/router";

interface CanvasStep {
  id: string;
  label: string;
  type: string;
  actor?: string;
  requires?: string[];
  produces?: string[];
}

interface CanvasEdge {
  from: string;
  to: string;
  label?: string;
  kind: string;
}

interface CanvasActor {
  id: string;
  label: string;
}

interface ClickTarget {
  stepId: string;
  flow?: string;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 64;

/** Stable, theme-friendly color per actor: hash → hue, fixed sat/lightness. */
export function actorColor(actorId: string): string {
  let hash = 0;
  for (let i = 0; i < actorId.length; i++) {
    hash = (hash * 31 + actorId.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 62% 46%)`;
}

const NO_ACTOR_COLOR = "hsl(0 0% 55%)";

export function layout(steps: CanvasStep[], edges: CanvasEdge[]): Node[] {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "TB", nodesep: 42, ranksep: 64 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const step of steps) {
    graph.setNode(step.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    if (steps.some((s) => s.id === edge.from) && steps.some((s) => s.id === edge.to)) {
      graph.setEdge(edge.from, edge.to);
    }
  }
  dagre.layout(graph);
  return steps.map((step) => {
    const position = graph.node(step.id);
    return {
      id: step.id,
      type: "step",
      position: {
        x: (position?.x ?? 0) - NODE_WIDTH / 2,
        y: (position?.y ?? 0) - NODE_HEIGHT / 2,
      },
      data: { ...step },
    } satisfies Node;
  });
}

function StepNode({ data }: NodeProps): ReactElement {
  const step = data as unknown as CanvasStep;
  const color = step.actor ? actorColor(step.actor) : NO_ACTOR_COLOR;
  return (
    <div className={`ls-node ls-${step.type}`} style={{ borderLeftColor: color }}>
      <Handle type="target" position={Position.Top} />
      <div className="ls-head">
        <span className="ls-type">{step.type.toUpperCase()}</span>
        {step.actor ? (
          <span className="ls-actor" style={{ background: color }}>
            {step.actor}
          </span>
        ) : null}
      </div>
      <div className="ls-label">{step.label}</div>
      {(step.requires?.length ?? 0) > 0 || (step.produces?.length ?? 0) > 0 ? (
        <div className="ls-context">
          {(step.requires ?? []).map((name) => (
            <span key={`r-${name}`} className="ls-chip ls-requires" title={`requires ${name}`}>
              ↓{name}
            </span>
          ))}
          {(step.produces ?? []).map((name) => (
            <span key={`p-${name}`} className="ls-chip ls-produces" title={`produces ${name}`}>
              ↑{name}
            </span>
          ))}
        </div>
      ) : null}
      {step.type !== "final" ? <Handle type="source" position={Position.Bottom} /> : null}
    </div>
  );
}

const nodeTypes = { step: StepNode };

export interface CanvasProps {
  steps: CanvasStep[];
  edges: CanvasEdge[];
  actors: CanvasActor[];
  clickMap: Record<string, ClickTarget>;
}

export function Canvas({ steps, edges, actors, clickMap }: CanvasProps): ReactElement {
  const [nodes, setNodes] = useState<Node[]>(() => layout(steps, edges));
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredActor, setHoveredActor] = useState<string | null>(null);

  // Re-layout when `steps`/`edges` change — not just on first mount. Without
  // this, live reload (Task 11) would leave the canvas showing stale data:
  // React reuses this component instance across prop updates, so a plain
  // lazy `useState` initializer alone only ever runs once.
  useEffect(() => {
    setNodes(layout(steps, edges));
  }, [steps, edges]);

  const related = useMemo(() => {
    if (hoveredActor !== null) {
      const set = new Set<string>();
      for (const node of nodes) {
        if ((node.data as unknown as CanvasStep).actor === hoveredActor) set.add(node.id);
      }
      return set;
    }
    if (hovered === null) return null;
    const set = new Set<string>([hovered]);
    for (const edge of edges) {
      if (edge.from === hovered) set.add(edge.to);
      if (edge.to === hovered) set.add(edge.from);
    }
    return set;
  }, [hovered, hoveredActor, nodes, edges]);

  const displayNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        className: related !== null && !related.has(node.id) ? "ls-dim" : undefined,
      })),
    [nodes, related],
  );

  const displayEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge, index) => {
        const isFocus =
          related !== null &&
          (hoveredActor !== null
            ? related.has(edge.from) && related.has(edge.to)
            : edge.from === hovered || edge.to === hovered);
        const dimmed = related !== null && !isFocus;
        return {
          id: `e${index}`,
          source: edge.from,
          target: edge.to,
          label: edge.label,
          animated: edge.kind === "event" && !dimmed,
          className: dimmed ? "ls-dim" : isFocus ? "ls-focus" : undefined,
          style: {
            strokeDasharray: edge.kind === "event" ? "5 4" : undefined,
            strokeWidth: isFocus ? 2.5 : 1.5,
          },
          labelStyle: { fontSize: 10, opacity: dimmed ? 0.15 : 1 },
          markerEnd: { type: "arrowclosed" as const },
        };
      }),
    [edges, related, hovered, hoveredActor],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  const onNodeClick = useCallback(
    (_event: unknown, node: Node) => {
      const target = clickMap[node.id];
      if (target === undefined) return;
      if (target.flow !== undefined) {
        navigate(`/features/${encodeURIComponent(target.flow)}`);
        return;
      }
      // Radix's TabsTrigger activates a tab on `mousedown` (see
      // @radix-ui/react-tabs), never on `click` — HTMLElement.click() only
      // ever dispatches a `click` event, so `tabTrigger.click()` is a no-op
      // here (verified against a real browser). Dispatch the event Radix
      // actually listens for instead.
      const tabTrigger = document.querySelector<HTMLElement>('[data-tab-trigger="steps"]');
      tabTrigger?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
      );
      // The Steps tab's content isn't mounted while inactive (no
      // `forceMount`), so `step-${id}` doesn't exist in the DOM until React
      // flushes the tab-switch state update triggered above — defer to the
      // next tick so the row exists by the time we look for it.
      setTimeout(() => {
        const row = document.getElementById(`step-${target.stepId}`);
        row?.scrollIntoView({ block: "center" });
      }, 0);
    },
    [clickMap],
  );

  return (
    // @xyflow/react's <ReactFlow style={...}> prop is merged *before* the
    // library's own `wrapperStyle` (`width/height: 100%`), so a `height`
    // passed via `style` is silently clobbered and the canvas collapses to
    // 0px in an unsized parent (confirmed against the installed
    // @xyflow/react 12.11.2). Give the wrapper the explicit height instead.
    <div style={{ height: 600 }}>
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeMouseEnter={(_event, node) => setHovered(node.id)}
        onNodeMouseLeave={() => setHovered(null)}
        onNodeClick={onNodeClick}
        fitView
        minZoom={0.15}
        maxZoom={4}
      >
        <Background gap={18} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => {
            const actor = (node.data as unknown as CanvasStep).actor;
            return actor ? actorColor(actor) : NO_ACTOR_COLOR;
          }}
        />
        {actors.length > 0 ? (
          <Panel position="top-left" className="ls-legend">
            {actors.map((actor) => (
              // biome-ignore lint/a11y/noStaticElementInteractions: hover-only decorative highlight, no click/keyboard action to make accessible
              <div
                key={actor.id}
                className="ls-legend-item"
                onMouseEnter={() => setHoveredActor(actor.id)}
                onMouseLeave={() => setHoveredActor(null)}
              >
                <span className="ls-swatch" style={{ background: actorColor(actor.id) }} />
                {actor.label}
              </div>
            ))}
          </Panel>
        ) : null}
      </ReactFlow>
    </div>
  );
}
