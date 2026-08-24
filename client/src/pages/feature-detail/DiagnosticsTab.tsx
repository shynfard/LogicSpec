interface Diagnostic {
  code: string;
  severity: string;
  message: string;
  line?: number;
  column?: number;
}

export function DiagnosticsTab({ diagnostics, path }: { diagnostics: Diagnostic[]; path: string }) {
  if (diagnostics.length === 0) return <p className="p-4 text-muted-foreground">No findings.</p>;
  return (
    <div className="space-y-2">
      {diagnostics.map((d) => (
        <div
          key={`${d.code}-${d.line ?? ""}-${d.column ?? ""}-${d.message}`}
          className={`border-l-4 p-3 ${d.severity === "error" ? "border-destructive" : d.severity === "warning" ? "border-yellow-500" : "border-muted"}`}
        >
          <strong>{d.code}</strong> {d.severity} — {d.message}
          <div className="text-xs text-muted-foreground">
            {path}
            {d.line !== undefined ? `:${d.line}:${d.column}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
