import mermaid from "mermaid";
import { useEffect, useRef } from "react";

mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

export function MermaidView({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null || source === "") return;
    let cancelled = false;
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    mermaid
      .render(id, source)
      .then(({ svg }) => {
        if (!cancelled) el.innerHTML = svg;
      })
      .catch(() => {
        if (!cancelled) el.innerHTML = "";
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  return <div ref={ref} className="h-full overflow-auto" />;
}
