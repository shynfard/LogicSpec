import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "@/lib/router";
import { useApi } from "@/lib/useApi";
import { DiagnosticsTab } from "./feature-detail/DiagnosticsTab";
import { DiagramTab } from "./feature-detail/DiagramTab";
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

  if (error !== null) return <p className="p-6 text-destructive">{error}</p>;
  if (data === null) return <p className="p-6 text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <Link to="/" className="text-sm hover:underline">
          &larr; Dashboard
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          {data.name}
          <Badge variant={data.valid ? "default" : "destructive"}>
            {data.valid ? "valid" : "invalid"}
          </Badge>
        </h1>
        <p className="text-xs text-muted-foreground">
          {data.id} · {data.path}
        </p>
      </div>
      <Tabs defaultValue="diagram">
        <div className="mx-auto max-w-4xl">
          <TabsList>
            <TabsTrigger value="diagram">Diagram</TabsTrigger>
            <TabsTrigger value="steps">Steps</TabsTrigger>
            <TabsTrigger value="source">Source</TabsTrigger>
            <TabsTrigger value="inspect">Inspect</TabsTrigger>
            <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
            <TabsTrigger value="related">Related</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="diagram">
          {data.diagram === undefined ? (
            <p className="mx-auto max-w-4xl p-4 text-muted-foreground">
              Spec is invalid — see the Diagnostics tab.
            </p>
          ) : (
            <DiagramTab diagram={data.diagram} />
          )}
        </TabsContent>
        <TabsContent value="steps" className="mx-auto max-w-4xl">
          {data.diagram === undefined ? (
            <p className="p-4 text-muted-foreground">Spec is invalid — see the Diagnostics tab.</p>
          ) : (
            <StepsTab steps={data.diagram.steps} />
          )}
        </TabsContent>
        <TabsContent value="source" className="mx-auto max-w-4xl">
          <SourceTab source={data.source} />
        </TabsContent>
        <TabsContent value="inspect" className="mx-auto max-w-4xl">
          {data.inspect === undefined ? (
            <p className="p-4 text-muted-foreground">Spec is invalid — see the Diagnostics tab.</p>
          ) : (
            <InspectTab inspect={data.inspect} />
          )}
        </TabsContent>
        <TabsContent value="diagnostics" className="mx-auto max-w-4xl">
          <DiagnosticsTab diagnostics={data.diagnostics} path={data.path} />
        </TabsContent>
        <TabsContent value="related" className="mx-auto max-w-4xl">
          <RelatedTab related={data.related} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
