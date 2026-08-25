import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/lib/router";
import { useApi } from "@/lib/useApi";

interface FeatureSummary {
  id: string;
  name: string;
  description?: string;
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
    <div className="mx-auto max-w-5xl p-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Feature</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Path</TableHead>
            <TableHead className="text-right">Steps</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {features.map((feature) => (
            <TableRow key={feature.id}>
              <TableCell>
                <Link
                  to={`/features/${encodeURIComponent(feature.id)}`}
                  className="font-medium hover:underline"
                >
                  {feature.name}
                </Link>
                <div className="text-xs text-muted-foreground">{feature.id}</div>
              </TableCell>
              <TableCell
                className="max-w-xs truncate text-muted-foreground"
                title={feature.description}
              >
                {feature.description ?? ""}
              </TableCell>
              <TableCell className="text-muted-foreground">{feature.path}</TableCell>
              <TableCell className="text-right">{feature.steps}</TableCell>
              <TableCell>
                <ValidityBadge feature={feature} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
