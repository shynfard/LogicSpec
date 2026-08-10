import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import {
  addStep,
  addTransition,
  deleteStep,
  loadEditableFeature,
  removeTransitionAt,
  renameStep,
  serializeFeature,
  setStepField,
  type EditableFeature,
  type EditableStepField,
  type FeatureGraph,
  type NormalizedFeature,
  type StepType,
} from "logicspec/core";
import { Canvas } from "./components/Canvas";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { Inspector } from "./components/Inspector";
import { Palette } from "./components/Palette";
import { Toolbar, type EditorStatus } from "./components/Toolbar";
import {
  derive,
  toFlow,
  uniqueStepId,
  type StepFlowNode,
  type TransitionEdge,
} from "./lib/editorState";
import type { Position } from "./lib/layout";
import { SEED_YAML } from "./lib/seed";

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

interface GraphView {
  feature: NormalizedFeature;
  graph: FeatureGraph;
}

export default function App() {
  const [yamlText, setYamlText] = useState(SEED_YAML);
  // The YAML text is the single source of truth. The ref mirrors it so that
  // several mutations fired in one event loop each see the latest document.
  const yamlRef = useRef(SEED_YAML);
  const positionsRef = useRef(new Map<string, Position>());
  const [toast, setToast] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const updateYaml = useCallback((next: string) => {
    yamlRef.current = next;
    setYamlText(next);
  }, []);

  const debouncedYaml = useDebounced(yamlText, 400);
  const derived = useMemo(() => derive(debouncedYaml), [debouncedYaml]);

  // Keep showing the last parseable graph while the YAML is broken.
  const [view, setView] = useState<GraphView | null>(null);
  useEffect(() => {
    if (derived.feature && derived.graph) {
      setView({ feature: derived.feature, graph: derived.graph });
    }
  }, [derived]);

  const [nodes, setNodes] = useState<StepFlowNode[]>([]);
  const [edges, setEdges] = useState<TransitionEdge[]>([]);
  const edgesRef = useRef<TransitionEdge[]>([]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    if (!view) return;
    const flow = toFlow(view.feature, view.graph, positionsRef.current);
    setNodes(flow.nodes);
    setEdges(flow.edges);
  }, [view]);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const mutate = useCallback(
    (apply: (editable: EditableFeature) => void): boolean => {
      try {
        const editable = loadEditableFeature(yamlRef.current);
        apply(editable);
        updateYaml(serializeFeature(editable));
        return true;
      } catch (error) {
        setToast(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    [updateYaml],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<StepFlowNode>[]) => {
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          positionsRef.current.set(change.id, change.position);
        }
      }
      const removals = changes.filter((change) => change.type === "remove");
      const rest = changes.filter((change) => change.type !== "remove");
      if (rest.length > 0) {
        setNodes((current) => applyNodeChanges(rest, current));
      }
      // Deletion goes through the YAML: the rebuild removes the node visually.
      for (const removal of removals) {
        mutate((editable) => deleteStep(editable, removal.id));
      }
      if (removals.length > 0) setSelectedId(null);
    },
    [mutate],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<TransitionEdge>[]) => {
      const removals = changes.filter((change) => change.type === "remove");
      const rest = changes.filter((change) => change.type !== "remove");
      if (rest.length > 0) {
        setEdges((current) => applyEdgeChanges(rest, current));
      }
      for (const removal of removals) {
        const edge = edgesRef.current.find((candidate) => candidate.id === removal.id);
        const path = edge?.data?.path;
        if (path) {
          mutate((editable) => removeTransitionAt(editable, path));
        }
      }
    },
    [mutate],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const { source, target } = connection;
      if (!source || !target) return;
      mutate((editable) => {
        addTransition(editable, source, target);
      });
    },
    [mutate],
  );

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    setSelectedId(params.nodes[0]?.id ?? null);
  }, []);

  const onAddStep = useCallback(
    (type: StepType) => {
      const id = uniqueStepId(view?.feature, type);
      if (mutate((editable) => addStep(editable, id, type))) {
        setSelectedId(id);
      }
    },
    [mutate, view],
  );

  const onRename = useCallback(
    (oldId: string, newId: string) => {
      if (mutate((editable) => renameStep(editable, oldId, newId))) {
        const position = positionsRef.current.get(oldId);
        if (position) positionsRef.current.set(newId, position);
        setSelectedId(newId);
      }
    },
    [mutate],
  );

  const onSetField = useCallback(
    (id: string, field: EditableStepField, value: string | undefined) => {
      mutate((editable) => setStepField(editable, id, field, value));
    },
    [mutate],
  );

  const onOpenFile = useCallback(
    (text: string) => {
      positionsRef.current.clear();
      setSelectedId(null);
      updateYaml(text);
    },
    [updateYaml],
  );

  const onSave = useCallback(() => {
    const name = `${view?.feature.id ?? "feature"}.feature.yaml`;
    const blob = new Blob([yamlRef.current], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [view]);

  const onCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(yamlRef.current)
      .then(() => setToast("YAML copied to clipboard"));
  }, []);

  const errorCount = derived.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const status: EditorStatus =
    derived.graph === undefined ? "broken" : derived.valid ? "valid" : "invalid";

  const selectedStep = view?.feature.steps.find((step) => step.id === selectedId);

  return (
    <div className="app">
      <Toolbar
        status={status}
        errorCount={errorCount}
        onOpen={onOpenFile}
        onSave={onSave}
        onCopy={onCopy}
      />
      <div className="main">
        <section className="panel source-panel">
          <header>YAML</header>
          <textarea
            value={yamlText}
            onChange={(event) => updateYaml(event.target.value)}
            spellCheck={false}
            aria-label="Feature YAML source"
          />
        </section>
        <section className="canvas-wrap">
          <Palette onAdd={onAddStep} />
          <Canvas
            nodes={nodes}
            edges={edges}
            dimmed={!derived.valid}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
          />
        </section>
        <section className="panel inspector-panel">
          <header>Inspector</header>
          <Inspector
            step={selectedStep}
            actors={view?.feature.actors.map((actor) => actor.id) ?? []}
            onRename={onRename}
            onSetField={onSetField}
          />
        </section>
      </div>
      <DiagnosticsPanel diagnostics={derived.diagnostics} />
      {toast !== null && <div className="toast">{toast}</div>}
    </div>
  );
}
