export function SourceTab({ source }: { source: string }) {
  return <pre className="overflow-auto rounded bg-muted p-4 text-xs">{source}</pre>;
}
