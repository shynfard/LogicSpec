export function InspectTab({ inspect }: { inspect: unknown }) {
  return (
    <pre className="overflow-auto rounded bg-muted p-4 text-xs">
      {JSON.stringify(inspect, null, 2)}
    </pre>
  );
}
