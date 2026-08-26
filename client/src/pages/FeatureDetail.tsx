import { useCallback, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { exportMermaidView, type MermaidExportFormat } from "@/lib/export";
import { Link } from "@/lib/router";
import { useApi } from "@/lib/useApi";
import { DiagnosticsTab } from "./feature-detail/DiagnosticsTab";
import { DIAGRAM_VIEWS, DiagramTab, type DiagramView } from "./feature-detail/DiagramTab";
import { InspectTab } from "./feature-detail/InspectTab";
import { RelatedTab } from "./feature-detail/RelatedTab";
import { SourceTab } from "./feature-detail/SourceTab";
import { StepsTab } from "./feature-detail/StepsTab";

export interface FeatureDetailData {
  id: string;
  name: string;
  path: string;
  source: string;
  valid: boolean;
  diagnostics: Array<{
    code: string;
    severity: string;
    message: string;
    line?: number;
    column?: number;
  }>;
  diagram?: {
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
  };
  inspect?: { feature: string };
  related: {
    subflows: Array<{ id: string; name: string; known: boolean }>;
    dependents: Array<{ id: string; name: string; known: boolean }>;
    events: Array<{
      event: string;
      direction: "publish" | "wait";
      feature: { id: string; name: string; known: boolean };
    }>;
  };
}

export function FeatureDetail({ id }: { id: string }) {
  const { data, error } = useApi<FeatureDetailData>(`/api/features/${encodeURIComponent(id)}`);
  const [tab, setTab] = useState("diagram");
  const [view, setView] = useState<DiagramView>("interactive");
  const canvasExportRef = useRef<((filename: string) => Promise<void>) | null>(null);
  const registerCanvasExport = useCallback((exporter: (filename: string) => Promise<void>) => {
    canvasExportRef.current = exporter;
  }, []);

  const runExport = (format: string) => {
    const mermaidSource = data?.diagram?.mermaid[view] ?? "";
    const baseName = `${id}-${view}`;
    const task =
      view === "interactive"
        ? (canvasExportRef.current?.(`${baseName}.png`) ??
          Promise.reject(new Error("Canvas is not ready yet.")))
        : exportMermaidView(
            baseName,
            format as MermaidExportFormat,
            mermaidSource,
            document.querySelector("[data-mermaid-view]"),
          );
    task.catch(() => {
      // Export is best-effort UI sugar; a failure (canvas not mounted yet,
      // rasterization refused) must not take the page down.
    });
  };

  if (error !== null) return <p className="p-6 text-destructive">{error}</p>;
  if (data === null) return <p className="p-6 text-muted-foreground">Loading…</p>;

  return (
    // A single full-screen app shell (like Miro): a slim top bar holding
    // navigation, the tab switcher and (on Diagram) the view picker, with
    // whichever tab is active filling the entire rest of the viewport —
    // not a page you scroll past a header/breadcrumb/tab-row to reach.
    <Tabs value={tab} onValueChange={setTab} className="flex h-screen flex-col gap-0">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Link to="/" className="shrink-0 text-sm hover:underline">
          &larr; Dashboard
        </Link>
        <div className="flex shrink-0 items-center gap-2" title={`${data.id} · ${data.path}`}>
          <span className="font-semibold">{data.name}</span>
          <Badge variant={data.valid ? "default" : "destructive"}>
            {data.valid ? "valid" : "invalid"}
          </Badge>
        </div>
        <TabsList>
          <TabsTrigger value="diagram">Diagram</TabsTrigger>
          <TabsTrigger value="steps">Steps</TabsTrigger>
          <TabsTrigger value="source">Source</TabsTrigger>
          <TabsTrigger value="inspect">Inspect</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
          <TabsTrigger value="related">Related</TabsTrigger>
        </TabsList>
        {tab === "diagram" && data.diagram !== undefined ? (
          <div className="ml-auto flex items-center gap-2">
            <Select value={view} onValueChange={(v) => setView(v as DiagramView)}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIAGRAM_VIEWS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* An action menu, not a value: the controlled value stays ""
                so the trigger always reads "Export" and picking an item
                fires the download. */}
            <Select value="" onValueChange={runExport}>
              <SelectTrigger className="w-32" aria-label="Export diagram">
                <SelectValue placeholder="Export" />
              </SelectTrigger>
              <SelectContent>
                {view === "interactive" ? (
                  <SelectItem value="png">PNG image</SelectItem>
                ) : (
                  <>
                    <SelectItem value="png">PNG image</SelectItem>
                    <SelectItem value="svg">SVG image</SelectItem>
                    <SelectItem value="mmd">Mermaid source</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      <TabsContent value="diagram" className="min-h-0 flex-1">
        {data.diagram === undefined ? (
          <p className="p-4 text-muted-foreground">Spec is invalid — see the Diagnostics tab.</p>
        ) : (
          <DiagramTab
            diagram={data.diagram}
            view={view}
            registerCanvasExport={registerCanvasExport}
          />
        )}
      </TabsContent>
      <TabsContent value="steps" className="min-h-0 flex-1 overflow-auto p-4">
        {data.diagram === undefined ? (
          <p className="text-muted-foreground">Spec is invalid — see the Diagnostics tab.</p>
        ) : (
          <StepsTab steps={data.diagram.steps} />
        )}
      </TabsContent>
      <TabsContent value="source" className="min-h-0 flex-1 overflow-auto p-4">
        <SourceTab source={data.source} />
      </TabsContent>
      <TabsContent value="inspect" className="min-h-0 flex-1 overflow-auto p-4">
        {data.inspect === undefined ? (
          <p className="text-muted-foreground">Spec is invalid — see the Diagnostics tab.</p>
        ) : (
          <InspectTab inspect={data.inspect} />
        )}
      </TabsContent>
      <TabsContent value="diagnostics" className="min-h-0 flex-1 overflow-auto p-4">
        <DiagnosticsTab diagnostics={data.diagnostics} path={data.path} />
      </TabsContent>
      <TabsContent value="related" className="min-h-0 flex-1 overflow-auto p-4">
        <RelatedTab related={data.related} />
      </TabsContent>
    </Tabs>
  );
}
