/**
 * Interactive diagram canvas for the LogicSpec preview: React Flow + dagre.
 * Receives { type: "canvas", nodes, edges, actors } messages and renders a
 * draggable, zoomable node view with hover connection-tracing and stable
 * per-actor colors. Positions are ephemeral — nothing is ever persisted.
 */
import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createRoot } from "react-dom/client";

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

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscodeApi =
  (window as unknown as { __logicspecVsCode?: { postMessage(m: unknown): void } })
    .__logicspecVsCode ?? acquireVsCodeApi();
(window as unknown as { __logicspecVsCode?: unknown }).__logicspecVsCode = vscodeApi;

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

function layout(steps: CanvasStep[], edges: CanvasEdge[]): Node[] {
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

function App(): ReactElement | null {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [actors, setActors] = useState<CanvasActor[]>([]);
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredActor, setHoveredActor] = useState<string | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as {
        type?: string;
        nodes?: CanvasStep[];
        edges?: CanvasEdge[];
        actors?: CanvasActor[];
      };
      if (message?.type === "canvas" && Array.isArray(message.nodes) && Array.isArray(message.edges)) {
        setNodes(layout(message.nodes, message.edges));
        setEdges(message.edges);
        setActors(Array.isArray(message.actors) ? message.actors : []);
        setActive(true);
        document.getElementById("diagram")?.setAttribute("hidden", "true");
        document.getElementById("canvas")?.removeAttribute("hidden");
      } else if (message?.type === "render") {
        setActive(false);
        document.getElementById("canvas")?.setAttribute("hidden", "true");
        document.getElementById("diagram")?.removeAttribute("hidden");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Hover focus: the hovered node plus direct neighbors stay lit (or, when
  // hovering the legend, every node of that actor); everything else dims so
  // a step's relations stand out.
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

  if (!active) return null;
  return (
    <ReactFlow
      nodes={displayNodes}
      edges={displayEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeMouseEnter={(_event, node) => setHovered(node.id)}
      onNodeMouseLeave={() => setHovered(null)}
      onNodeClick={(_event, node) => {
        if (clickTimer.current !== null) clearTimeout(clickTimer.current);
        clickTimer.current = setTimeout(() => {
          clickTimer.current = null;
          vscodeApi.postMessage({ type: "nodeDetails", node: node.id });
        }, 220);
      }}
      onNodeDoubleClick={(_event, node) => {
        if (clickTimer.current !== null) {
          clearTimeout(clickTimer.current);
          clickTimer.current = null;
        }
        vscodeApi.postMessage({ type: "nodeClick", node: node.id });
      }}
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
  );
}

const host = document.getElementById("canvas");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
