import type { ReactNode } from "react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Link } from "@/lib/router";
import { useApi } from "@/lib/useApi";

interface PanelStep {
  id: string;
  type: string;
  label: string;
  actor?: string;
  description?: string;
  notes?: string;
  tags?: string[];
  requires?: string[];
  produces?: string[];
  details?: Array<{ flow: string; note?: string }>;
}

interface PanelEdge {
  from: string;
  to: string;
  kind: string;
  label?: string;
}

interface ClickTarget {
  stepId: string;
  flow?: string;
}

interface LinkedFeature {
  name: string;
  description?: string;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

export interface StepDetailPanelProps {
  steps: PanelStep[];
  edges: PanelEdge[];
  clickMap: Record<string, ClickTarget>;
  stepId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function StepDetailPanel({
  steps,
  edges,
  clickMap,
  stepId,
  onOpenChange,
}: StepDetailPanelProps) {
  const step = useMemo(() => steps.find((s) => s.id === stepId) ?? null, [steps, stepId]);
  const flow = stepId !== null ? clickMap[stepId]?.flow : undefined;

  const stepLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of steps) map.set(s.id, s.label);
    return map;
  }, [steps]);

  const incoming = useMemo(
    () => (stepId === null ? [] : edges.filter((e) => e.to === stepId)),
    [edges, stepId],
  );
  const outgoing = useMemo(
    () => (stepId === null ? [] : edges.filter((e) => e.from === stepId)),
    [edges, stepId],
  );

  const { data: linkedFeature } = useApi<LinkedFeature>(
    flow !== undefined ? `/api/features/${encodeURIComponent(flow)}` : null,
  );

  return (
    <Sheet open={step !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {step === null ? null : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Badge variant="outline">{step.type}</Badge>
                {step.label}
              </SheetTitle>
              <SheetDescription className="font-mono text-xs">{step.id}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-4 text-sm">
              {step.actor ? <Field label="Actor">{step.actor}</Field> : null}
              {step.description ? (
                <Field label="Description">
                  <p>{step.description}</p>
                </Field>
              ) : null}
              {step.notes ? (
                <Field label="Notes">
                  <p className="text-muted-foreground italic">{step.notes}</p>
                </Field>
              ) : null}
              {(step.tags?.length ?? 0) > 0 ? (
                <Field label="Tags">
                  <div className="flex flex-wrap gap-1">
                    {step.tags?.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </Field>
              ) : null}
              {(step.details?.length ?? 0) > 0 ? (
                <Field label="Detailed by">
                  <ul className="list-disc pl-5">
                    {step.details?.map((ref) => (
                      <li key={ref.flow}>
                        <Link
                          to={`/features/${encodeURIComponent(ref.flow)}`}
                          className="text-primary hover:underline"
                        >
                          {ref.flow}
                        </Link>
                        {ref.note !== undefined ? (
                          <span className="text-muted-foreground"> — {ref.note}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Field>
              ) : null}
              {(step.requires?.length ?? 0) > 0 ? (
                <Field label="Requires">
                  <div className="flex flex-wrap gap-1">
                    {step.requires?.map((name) => (
                      <Badge key={name} variant="outline">
                        ↓{name}
                      </Badge>
                    ))}
                  </div>
                </Field>
              ) : null}
              {(step.produces?.length ?? 0) > 0 ? (
                <Field label="Produces">
                  <div className="flex flex-wrap gap-1">
                    {step.produces?.map((name) => (
                      <Badge key={name} variant="outline">
                        ↑{name}
                      </Badge>
                    ))}
                  </div>
                </Field>
              ) : null}
              {incoming.length > 0 ? (
                <Field label="Incoming">
                  <ul className="space-y-1">
                    {incoming.map((e) => (
                      <li key={`${e.from}|${e.to}|${e.kind}`}>
                        ← {stepLabels.get(e.from) ?? e.from}
                        {e.label ? (
                          <span className="text-muted-foreground"> ({e.label})</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Field>
              ) : null}
              {outgoing.length > 0 ? (
                <Field label="Outgoing">
                  <ul className="space-y-1">
                    {outgoing.map((e) => (
                      <li key={`${e.from}|${e.to}|${e.kind}`}>
                        → {stepLabels.get(e.to) ?? e.to}
                        {e.label ? (
                          <span className="text-muted-foreground"> ({e.label})</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Field>
              ) : null}
              {flow !== undefined ? (
                <div className="space-y-2 rounded border p-3">
                  <div className="text-xs font-medium text-muted-foreground">Linked feature</div>
                  {linkedFeature === null ? (
                    <p className="text-muted-foreground">Loading…</p>
                  ) : (
                    <>
                      <div className="font-medium">{linkedFeature.name}</div>
                      {linkedFeature.description ? (
                        <p className="text-muted-foreground">{linkedFeature.description}</p>
                      ) : null}
                    </>
                  )}
                  <Link
                    to={`/features/${encodeURIComponent(flow)}`}
                    className="inline-block text-sm font-medium hover:underline"
                  >
                    Open feature →
                  </Link>
                </div>
              ) : null}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
