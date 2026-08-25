import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Link } from "@/lib/router";
import { useApi } from "@/lib/useApi";

interface FeatureSummary {
  id: string;
  name: string;
  path: string;
  valid: boolean;
  errorCount: number;
  warningCount: number;
  steps: number;
}

function ValidityBadge({ feature }: { feature: FeatureSummary }) {
  if (!feature.valid) {
    return (
      <Badge variant="destructive">
        {feature.errorCount} error{feature.errorCount === 1 ? "" : "s"}
      </Badge>
    );
  }
  if (feature.warningCount > 0) {
    return (
      <Badge variant="secondary">
        {feature.warningCount} warning{feature.warningCount === 1 ? "" : "s"}
      </Badge>
    );
  }
  return <Badge>valid</Badge>;
}

export function FeatureList() {
  const { data: features, error } = useApi<FeatureSummary[]>("/api/features");

  if (error !== null) return <p className="p-6 text-destructive">{error}</p>;
  if (features === null) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (features.length === 0)
    return <p className="p-6 text-muted-foreground">No features found in this workspace.</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-6">
      {features.map((feature) => (
        <Card key={feature.id} className="p-4">
          <Link
            to={`/features/${encodeURIComponent(feature.id)}`}
            className="text-lg font-semibold hover:underline"
          >
            {feature.name}
          </Link>{" "}
          <ValidityBadge feature={feature} />
          <div className="mt-1 text-xs text-muted-foreground">
            {feature.id} · {feature.path} · {feature.steps} step{feature.steps === 1 ? "" : "s"}
          </div>
        </Card>
      ))}
    </div>
  );
}
